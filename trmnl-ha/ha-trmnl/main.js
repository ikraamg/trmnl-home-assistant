/**
 * Main Application Entry Point
 *
 * This file orchestrates the entire TRMNL HA add-on system, managing:
 * - HTTP server for screenshot requests and UI/API endpoints
 * - Browser lifecycle (Puppeteer) with automatic cleanup and health monitoring
 * - Request queue management ensuring sequential screenshot processing
 * - Browser crash detection and automatic recovery
 * - Scheduler integration for automated screenshot capture
 *
 * Architecture:
 * - RequestHandler: Central coordinator handling all incoming HTTP requests
 * - Browser: Puppeteer wrapper for Home Assistant UI screenshots
 * - Scheduler: Cron-based automated screenshot execution
 * - HttpRouter: Routes API, UI, and health check endpoints
 *
 * Key Design Patterns:
 * - Promise-based queue for serializing browser operations
 * - Timeout-based browser cleanup when idle
 * - Two-stage recovery (health check → recovery attempt → retry)
 * - Graceful shutdown with resource cleanup
 *
 * @module main
 */

import http from 'node:http'
import { Browser } from './screenshot.js'
import {
  isAddOn,
  hassUrl,
  hassToken,
  keepBrowserOpen,
  BROWSER_TIMEOUT,
  MAX_SCREENSHOTS_BEFORE_RESTART,
} from './const.js'
import {
  CannotOpenPageError,
  BrowserCrashError,
  PageCorruptedError,
  BrowserHealthCheckError,
  BrowserRecoveryFailedError,
} from './error.js'
import { Scheduler } from './scheduler.js'
import { BrowserHealthMonitor } from './lib/browserHealth.js'
import { BrowserRecoveryManager } from './lib/browserRecovery.js'
import { HttpRouter } from './lib/http-router.js'
import { ScreenshotParamsParser } from './lib/screenshot-params-parser.js'

// Maximum number of next requests to keep in memory
const MAX_NEXT_REQUESTS = 100

/**
 * Central request handler coordinating all HTTP requests and browser operations.
 *
 * Responsibilities:
 * - Routes incoming HTTP requests to appropriate handlers (API, UI, screenshots)
 * - Manages browser lifecycle with automatic cleanup after idle periods
 * - Serializes screenshot requests using Promise-based queue (only one browser operation at a time)
 * - Monitors browser health and triggers automatic recovery on failures
 * - Handles "next" parameter for preloading pages to reduce latency
 *
 * Queue Pattern:
 * Uses #busy flag and #pending array to serialize async operations. When busy, incoming
 * requests push a resolve callback into #pending. When operation completes, the first
 * pending resolve is called, releasing the next queued request. This ensures browser
 * operations never overlap (Puppeteer pages are not thread-safe).
 *
 * Recovery Strategy:
 * Two-stage approach: (1) Check browser health via health monitor, (2) If unhealthy,
 * trigger recovery manager to restart browser, (3) Retry failed operation once. Prevents
 * cascade failures while giving requests a second chance after recovery.
 *
 * Cleanup Strategy:
 * Dual cleanup mechanism prevents resource accumulation:
 * 1. Idle Timeout: Browser cleanup after BROWSER_TIMEOUT ms of inactivity (default: 60s)
 * 2. Request-Based: Proactive cleanup after MAX_SCREENSHOTS_BEFORE_RESTART successful screenshots
 * Idle timeout uses cascading timers - each request resets the cleanup timer. Request-based
 * cleanup prevents memory leaks in active sessions (auto-refresh, scheduled jobs) that never
 * go idle. Together, these strategies cover both inactive and active usage patterns.
 *
 * NOTE: Browser operations are CPU/memory intensive. Serialization is critical for stability.
 * AI: When modifying queue logic, ensure #busy and #pending remain synchronized.
 *
 * @class
 */
class RequestHandler {
  // Private fields
  #browser
  #router
  #healthMonitor
  #recoveryManager
  #paramsParser
  #busy = false
  #pending = []
  #requestCount = 0
  #nextRequests = []
  #navigationTime = 0
  #lastAccess = new Date()
  #browserCleanupTimer

  /**
   * Creates a new RequestHandler.
   *
   * @param {Browser} browser - Puppeteer browser wrapper instance
   */
  constructor(browser) {
    this.#browser = browser
    this.#healthMonitor = new BrowserHealthMonitor()
    this.#recoveryManager = new BrowserRecoveryManager(
      browser,
      this.#healthMonitor
    )
    this.#router = new HttpRouter(this.#healthMonitor, this.#recoveryManager)
    this.#paramsParser = new ScreenshotParamsParser()
  }

  // Bareword getters for external access
  get busy() {
    return this.#busy
  }

  get router() {
    return this.#router
  }

  // ===========================================================================
  // BROWSER LIFECYCLE MANAGEMENT
  // ===========================================================================

  /**
   * Checks if browser should be cleaned up due to inactivity.
   *
   * Cascading timeout strategy: Schedules itself to run after remaining idle time.
   * This ensures cleanup happens exactly when needed without polling. Each request
   * resets the timer via #markBrowserAccessed().
   *
   * NOTE: Cleanup only happens when not busy to avoid interrupting active operations.
   * @private
   */
  #runBrowserCleanupCheck = async () => {
    if (this.#busy) return

    const idleTime = Date.now() - this.#lastAccess.getTime()

    if (idleTime < BROWSER_TIMEOUT) {
      // Still within timeout window - reschedule check for remaining time
      const remainingTime = BROWSER_TIMEOUT - idleTime
      this.#browserCleanupTimer = setTimeout(
        this.#runBrowserCleanupCheck,
        remainingTime + 100
      )
      return
    }

    // Idle timeout exceeded - clean up browser
    await this.#browser.cleanup()
  }

  /**
   * Marks browser as accessed and resets cleanup timer.
   *
   * Called after every request to keep browser alive during active periods.
   * Cleanup timer is canceled and rescheduled for BROWSER_TIMEOUT ms in the future.
   *
   * @private
   */
  #markBrowserAccessed() {
    clearTimeout(this.#browserCleanupTimer)
    this.#lastAccess = new Date()

    if (keepBrowserOpen) return

    this.#browserCleanupTimer = setTimeout(
      this.#runBrowserCleanupCheck,
      BROWSER_TIMEOUT + 100
    )
  }

  /**
   * Checks and performs proactive browser cleanup based on request count.
   *
   * Request-Based Cleanup Strategy:
   * Prevents memory accumulation in long-running active sessions by restarting
   * browser after N successful screenshots. This complements idle timeout cleanup
   * which only triggers during inactivity.
   *
   * Why This Matters:
   * - Auto-refresh sessions generate hundreds of requests without going idle
   * - Puppeteer/Chrome accumulate resources: cached images, blob URLs, V8 heap
   * - Gradual memory growth can lead to OOM crashes after hours/days
   *
   * Cleanup Threshold:
   * MAX_SCREENSHOTS_BEFORE_RESTART (default: 100) successful screenshots triggers
   * cleanup. Counter resets after cleanup. Set to 0 to disable.
   *
   * Lifecycle:
   * 1. Call after each successful screenshot
   * 2. Increment #requestCount
   * 3. If threshold reached: cleanup browser, reset counter
   * 4. Browser relaunches automatically on next request
   *
   * NOTE: Cleanup is non-blocking - browser reopens lazily on next request.
   * AI: Adjust threshold based on memory usage patterns in production.
   *
   * @private
   * @returns {Promise<void>}
   */
  async #maybeCleanupAfterRequests() {
    if (MAX_SCREENSHOTS_BEFORE_RESTART <= 0) return
    if (keepBrowserOpen) return

    this.#requestCount++

    if (this.#requestCount >= MAX_SCREENSHOTS_BEFORE_RESTART) {
      console.log(
        `[Cleanup] Proactive browser cleanup after ${
          this.#requestCount
        } successful screenshots`
      )
      await this.#browser.cleanup()
      this.#requestCount = 0
    }
  }

  // ===========================================================================
  // BROWSER HEALTH & RECOVERY
  // ===========================================================================

  /**
   * Ensures browser is healthy before critical operations.
   *
   * Proactive health check that triggers recovery if browser is degraded.
   * Called before navigation to prevent operations on unhealthy browsers.
   *
   * @private
   * @throws {BrowserRecoveryFailedError} If recovery fails
   */
  async #ensureBrowserHealthy() {
    const health = this.#healthMonitor.checkHealth()

    if (!health.healthy) {
      console.warn(`[Health] Browser unhealthy: ${health.reason}`)
      await this.#recoveryManager.recover()
    }
  }

  /**
   * Handles browser crash/corruption errors with automatic recovery.
   *
   * Two-stage recovery:
   * 1. Classify error as browser-related (crash, corruption, health check failure)
   * 2. Record failure in health monitor - triggers recovery if threshold exceeded
   * 3. Attempt browser restart via recovery manager
   * 4. Caller can retry operation once if recovery succeeds
   *
   * NOTE: Not all browser errors trigger recovery - health monitor uses failure
   * count threshold to prevent thrashing from transient errors.
   *
   * @private
   * @param {Error} err - The error that occurred
   * @param {string|number} requestId - Request ID for logging
   * @returns {Promise<boolean>} True if recovery was attempted and succeeded
   * @throws {BrowserRecoveryFailedError} If recovery fails critically
   */
  async #handleBrowserError(err, requestId) {
    const isBrowserError =
      err instanceof BrowserCrashError ||
      err instanceof PageCorruptedError ||
      err instanceof BrowserHealthCheckError

    if (!isBrowserError) return false

    console.error(
      requestId,
      `Browser error detected: ${err.name} - ${err.message}`
    )

    // Record failure and check if we should trigger recovery
    const shouldRecover = this.#healthMonitor.recordFailure()

    if (shouldRecover || err instanceof BrowserCrashError) {
      try {
        await this.#recoveryManager.recover()
        return true
      } catch (recoveryErr) {
        if (recoveryErr instanceof BrowserRecoveryFailedError) {
          console.error(
            requestId,
            'CRITICAL: Browser recovery failed completely!'
          )
          console.error(
            requestId,
            'Server will continue but browser features unavailable'
          )
        }
        throw recoveryErr
      }
    }

    return false
  }

  // ===========================================================================
  // REQUEST HANDLING
  // ===========================================================================

  /**
   * Main request handler - entry point for all HTTP requests.
   *
   * Routes requests to either:
   * - HttpRouter: API endpoints (/api/schedules), UI (/), health checks (/health)
   * - Screenshot handler: All other requests (screenshot requests with query params)
   *
   * @param {http.IncomingMessage} request - HTTP request object
   * @param {http.ServerResponse} response - HTTP response object
   */
  async handleRequest(request, response) {
    const requestUrl = new URL(request.url, 'http://localhost')

    // Try router first (health, API, UI)
    const routed = await this.#router.route(request, response, requestUrl)
    if (routed) return

    // Not routed - must be a screenshot request
    await this.#handleScreenshotRequest(request, response, requestUrl)
  }

  /**
   * Handles screenshot requests with Promise-based queue management.
   *
   * Queue Pattern:
   * - If busy, creates a Promise and pushes its resolve callback into #pending array
   * - Promise waits until released by previous request's finally block
   * - Guarantees only one browser operation executes at a time (critical for Puppeteer stability)
   *
   * Request Flow:
   * 1. Queue if busy (Promise-based wait)
   * 2. Parse screenshot parameters from URL query string
   * 3. Navigate to Home Assistant page (with health check and recovery)
   * 4. Take screenshot and process with dithering
   * 5. Check request-based cleanup threshold (proactive memory management)
   * 6. Send response with image buffer
   * 7. Handle "next" parameter for preloading (optional)
   * 8. Release next queued request and reset cleanup timer
   *
   * NOTE: finally block MUST release queue and mark browser accessed - critical for queue integrity.
   * AI: Do not add early returns without updating finally block.
   *
   * @private
   * @param {http.IncomingMessage} request - HTTP request object
   * @param {http.ServerResponse} response - HTTP response object
   * @param {URL} requestUrl - Parsed URL object with query parameters
   */
  async #handleScreenshotRequest(request, response, requestUrl) {
    const requestId = ++this.#requestCount
    console.debug(requestId, 'Request', request.url)

    const start = new Date()

    // Queue if busy - Promise resolves when previous request completes
    if (this.#busy) {
      console.log(requestId, 'Busy, waiting in queue')
      await new Promise((resolve) => this.#pending.push(resolve))
      const end = Date.now()
      console.log(requestId, `Wait time: ${end - start} ms`)
    }

    this.#busy = true

    try {
      console.debug(requestId, 'Handling', request.url)

      // Parse screenshot parameters
      const params = this.#paramsParser.call(requestUrl)

      if (!params) {
        response.statusCode = 400
        response.end('Invalid parameters')
        return
      }

      // Navigate to page
      let navigateResult = null
      try {
        await this.#ensureBrowserHealthy()
        navigateResult = await this.#browser.navigatePage(params)
        this.#healthMonitor.recordSuccess()
      } catch (err) {
        if (err instanceof CannotOpenPageError) {
          console.error(requestId, `Cannot open page: ${err.message}`)
          response.statusCode = 404
          response.end(`Cannot open page: ${err.message}`)
          return
        }

        // Handle browser crashes with recovery
        const recovered = await this.#handleBrowserError(err, requestId)
        if (recovered) {
          console.log(requestId, 'Retrying navigation after recovery...')
          try {
            navigateResult = await this.#browser.navigatePage(params)
            this.#healthMonitor.recordSuccess()
          } catch (retryErr) {
            console.error(requestId, 'Retry failed after recovery:', retryErr)
            response.statusCode = 503
            response.end(
              'Service temporarily unavailable - browser recovery in progress'
            )
            return
          }
        } else {
          throw err
        }
      }

      console.debug(requestId, `Navigated in ${navigateResult.time} ms`)
      this.#navigationTime = Math.max(this.#navigationTime, navigateResult.time)

      // Take screenshot
      let screenshotResult
      try {
        screenshotResult = await this.#browser.screenshotPage(params)
        console.debug(requestId, `Screenshot in ${screenshotResult.time} ms`)
        this.#healthMonitor.recordSuccess()
        await this.#maybeCleanupAfterRequests()
      } catch (err) {
        const recovered = await this.#handleBrowserError(err, requestId)
        if (recovered) {
          response.statusCode = 503
          response.end('Screenshot failed - browser recovered, please retry')
        } else {
          throw err
        }
        return
      }

      // Send response
      const { image } = screenshotResult
      const contentType = this.#getContentType(params.format)

      response.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': image.length,
      })
      response.write(image)
      response.end()

      // Handle "next" parameter for preloading
      if (params.next) {
        this.#scheduleNextRequest(requestId, params, start)
      }
    } finally {
      this.#busy = false
      const resolve = this.#pending.shift()
      if (resolve) resolve()
      this.#markBrowserAccessed()
    }
  }

  /**
   * Maps image format to HTTP Content-Type header.
   *
   * @private
   * @param {string} format - Image format (png, jpeg, bmp)
   * @returns {string} MIME type
   */
  #getContentType(format) {
    if (format === 'jpeg') return 'image/jpeg'
    if (format === 'bmp') return 'image/bmp'
    return 'image/png'
  }

  /**
   * Schedules next request for preloading (latency optimization).
   *
   * Timing calculation: next interval minus (request time + navigation time + 1s buffer).
   * Preloads the page before next actual request to eliminate navigation latency.
   * Only schedules if calculated wait time is positive.
   *
   * NOTE: Limited to MAX_NEXT_REQUESTS to prevent memory leaks from abandoned timers.
   *
   * @private
   * @param {string|number} requestId - Request ID for logging
   * @param {Object} params - Screenshot parameters (includes params.next in seconds)
   * @param {Date} start - Request start time
   */
  #scheduleNextRequest(requestId, params, start) {
    const end = new Date()
    const requestTime = end.getTime() - start.getTime()
    const nextWaitTime =
      params.next * 1000 - requestTime - this.#navigationTime - 1000

    if (nextWaitTime < 0) return

    console.debug(requestId, `Next request in ${nextWaitTime} ms`)
    this.#nextRequests.push(
      setTimeout(
        () => this.#prepareNextRequest(requestId, params),
        nextWaitTime
      )
    )

    if (this.#nextRequests.length > MAX_NEXT_REQUESTS) {
      clearTimeout(this.#nextRequests.shift())
    }
  }

  /**
   * Prepares next request by preloading the page (navigation only, no screenshot).
   *
   * Triggered by timer set in #scheduleNextRequest. Navigates to Home Assistant page
   * so it's ready when the actual screenshot request arrives, eliminating navigation latency.
   * Sets extraWait to 0 since timing is handled by the scheduler/caller.
   *
   * NOTE: Skips if busy - preloading is opportunistic, not required.
   *
   * @private
   * @param {string|number} requestId - Request ID for logging (appends "-next")
   * @param {Object} params - Screenshot parameters (path, theme, language, etc.)
   */
  async #prepareNextRequest(requestId, params) {
    if (this.#busy) {
      console.log('Busy, skipping next request')
      return
    }

    requestId = `${requestId}-next`
    this.#busy = true
    console.log(requestId, 'Preparing next request')

    try {
      const navigateResult = await this.#browser.navigatePage({
        ...params,
        extraWait: 0,
      })
      console.debug(requestId, `Navigated in ${navigateResult.time} ms`)
    } catch (err) {
      console.error(requestId, 'Error preparing next request', err)
    } finally {
      this.#busy = false
      const resolve = this.#pending.shift()
      if (resolve) resolve()
      this.#markBrowserAccessed()
    }
  }

  /**
   * Public API for scheduler to take screenshots.
   *
   * Same queue management as HTTP requests - serializes browser operations.
   * Includes health check and recovery logic. Retries once if recovery succeeds.
   *
   * Workflow:
   * 1. Queue if busy (same Promise-based pattern as HTTP handler)
   * 2. Health check before navigation
   * 3. Navigate + screenshot
   * 4. On browser error: recover and retry once
   * 5. Check request-based cleanup threshold (proactive memory management)
   * 6. Release queue and reset cleanup timer
   *
   * @param {Object} params - Screenshot parameters (path, viewport, dithering, etc.)
   * @returns {Promise<Buffer>} Screenshot image buffer
   * @throws {Error} If screenshot fails after recovery attempt
   */
  async takeScreenshot(params) {
    if (this.#busy) {
      await new Promise((resolve) => this.#pending.push(resolve))
    }
    this.#busy = true

    try {
      await this.#ensureBrowserHealthy()
      await this.#browser.navigatePage(params)
      const result = await this.#browser.screenshotPage(params)
      this.#healthMonitor.recordSuccess()
      await this.#maybeCleanupAfterRequests()
      return result.image
    } catch (err) {
      const recovered = await this.#handleBrowserError(err, '[Scheduler]')
      if (recovered) {
        await this.#browser.navigatePage(params)
        const result = await this.#browser.screenshotPage(params)
        this.#healthMonitor.recordSuccess()
        await this.#maybeCleanupAfterRequests()
        return result.image
      }
      throw err
    } finally {
      this.#busy = false
      const resolve = this.#pending.shift()
      if (resolve) resolve()
      this.#markBrowserAccessed()
    }
  }
}

// Export RequestHandler for testing
export { RequestHandler }

// =============================================================================
// INITIALIZATION
// =============================================================================

// Create core services
const browser = new Browser(hassUrl, hassToken)
const requestHandler = new RequestHandler(browser)
const scheduler = new Scheduler((params) =>
  requestHandler.takeScreenshot(params)
)

// Connect scheduler to router for manual execution via /api/schedules/:id/send
requestHandler.router.setScheduler(scheduler)

// Start HTTP server
const port = 10000
const server = http.createServer((request, response) =>
  requestHandler.handleRequest(request, response)
)
server.listen(port)

// Start automated scheduler
scheduler.start()

// Log startup info
const now = new Date()
const serverUrl = isAddOn
  ? `http://homeassistant.local:${port}`
  : `http://localhost:${port}`
console.log(`[${now.toLocaleTimeString()}] Visit server at ${serverUrl}`)
console.log(`[${now.toLocaleTimeString()}] Scheduler is running`)

// =============================================================================
// SIMPLE RESILIENCE FEATURES
// =============================================================================

/**
 * Simple memory monitor - checks every 30 seconds
 * Logs warning at 700MB, exits cleanly at 900MB (Docker/HA will restart)
 *
 * Thresholds set for 1GB Docker limit:
 * - Normal operation: ~400MB (Chromium + Bun)
 * - Warn at 70%: 700MB (300MB headroom above normal)
 * - Exit at 90%: 900MB (100MB buffer before Docker OOM killer at 1GB)
 */
function startMemoryMonitor() {
  const WARN_THRESHOLD = 700 * 1024 * 1024 // 700MB (70% of 1GB)
  const EXIT_THRESHOLD = 900 * 1024 * 1024 // 900MB (90% of 1GB)

  setInterval(() => {
    const usage = process.memoryUsage()
    const rss = usage.rss
    const rssMB = (rss / 1024 / 1024).toFixed(2)

    if (rss > EXIT_THRESHOLD) {
      console.error(
        `[Memory] CRITICAL: ${rssMB}MB / 1024MB - Exiting for restart`
      )
      process.exit(1) // Exit cleanly, Docker/HA will restart us
    } else if (rss > WARN_THRESHOLD) {
      console.warn(`[Memory] WARNING: ${rssMB}MB / 1024MB`)
    }
  }, 30000) // Check every 30 seconds
}

/**
 * Simple log rotation - checks every 5 minutes
 * Rotates application logs if > 10MB, keeps last 3 files
 */
async function startLogRotation() {
  const { existsSync, statSync, renameSync, readdirSync, unlinkSync } =
    await import('node:fs')
  const path = await import('node:path')

  const LOG_DIR = './logs'
  const MAX_SIZE = 10 * 1024 * 1024 // 10MB
  const MAX_FILES = 3

  async function rotateLogsIfNeeded() {
    if (!existsSync(LOG_DIR)) return

    const logFiles = ['out.log', 'error.log']

    for (const logFile of logFiles) {
      const logPath = path.join(LOG_DIR, logFile)
      if (!existsSync(logPath)) continue

      const stats = statSync(logPath)
      if (stats.size > MAX_SIZE) {
        const timestamp = new Date()
          .toISOString()
          .replace(/[:.]/g, '-')
          .slice(0, 19)
        const rotatedPath = path.join(LOG_DIR, `${logFile}.${timestamp}`)

        try {
          renameSync(logPath, rotatedPath)
          console.log(
            `[LogRotate] Rotated ${logFile} (${(stats.size / 1024 / 1024).toFixed(2)}MB)`
          )

          // Cleanup old rotated files
          const allFiles = readdirSync(LOG_DIR)
          const rotatedFiles = allFiles
            .filter((f) => f.startsWith(logFile) && f !== logFile)
            .map((f) => ({
              name: f,
              mtime: statSync(path.join(LOG_DIR, f)).mtime,
            }))
            .sort((a, b) => b.mtime - a.mtime)

          // Delete files beyond MAX_FILES
          if (rotatedFiles.length > MAX_FILES) {
            rotatedFiles.slice(MAX_FILES).forEach((f) => {
              try {
                unlinkSync(path.join(LOG_DIR, f.name))
                console.log(`[LogRotate] Deleted old log: ${f.name}`)
              } catch (err) {
                console.error(
                  `[LogRotate] Error deleting ${f.name}: ${err.message}`
                )
              }
            })
          }
        } catch (err) {
          console.error(`[LogRotate] Error rotating ${logFile}: ${err.message}`)
        }
      }
    }
  }

  // Check every 5 minutes
  setInterval(rotateLogsIfNeeded, 5 * 60 * 1000)
  // Initial check after 1 minute
  setTimeout(rotateLogsIfNeeded, 60000)
}

// Start resilience features
startMemoryMonitor()
startLogRotation()

// =============================================================================
// CRASH RECOVERY & GRACEFUL SHUTDOWN
// =============================================================================

/**
 * Checks if error is browser-related by message content or error type.
 *
 * Used by process-level error handlers to decide if container restart is needed.
 * Browser errors indicate corrupted state that requires process restart.
 *
 * @param {Error} error - The error to check
 * @returns {boolean} True if error is browser-related
 */
function isBrowserRelatedError(error) {
  return (
    error?.message?.includes('browser') ||
    error?.message?.includes('chromium') ||
    error?.message?.includes('puppeteer') ||
    error instanceof BrowserCrashError ||
    error instanceof PageCorruptedError
  )
}

/**
 * Graceful shutdown handler for SIGTERM and SIGINT signals.
 *
 * Shutdown sequence:
 * 1. Stop scheduler (prevents new jobs from starting)
 * 2. Close HTTP server (stops accepting new connections)
 * 3. Clean up browser (close Puppeteer instance)
 * 4. Exit with code 0
 *
 * Force shutdown after 30 seconds if cleanup hangs.
 *
 * @param {string} signal - Signal name (SIGTERM or SIGINT)
 */
async function gracefulShutdown(signal) {
  console.log(
    `\n[${new Date().toLocaleTimeString()}] ${signal} received, shutting down gracefully...`
  )

  scheduler.stop()

  server.close(async () => {
    console.log(`[${new Date().toLocaleTimeString()}] HTTP server closed`)
    await browser.cleanup()
    console.log(`[${new Date().toLocaleTimeString()}] Browser cleaned up`)
    process.exit(0)
  })

  // Force shutdown after 30 seconds
  setTimeout(() => {
    console.error(
      `[${new Date().toLocaleTimeString()}] Forced shutdown after timeout`
    )
    process.exit(1)
  }, 30000)
}

// Handle graceful shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

// Handle uncaught exceptions
// NOTE: RequestHandler already has browser recovery logic built-in
// Process-level crashes trigger Docker/HA Supervisor to restart for clean recovery
process.on('uncaughtException', async (err) => {
  console.error(`[${new Date().toLocaleTimeString()}] Uncaught Exception:`, err)

  if (isBrowserRelatedError(err)) {
    console.error(
      '[Process] Browser-related crash detected, allowing container restart...'
    )
  }

  process.exit(1)
})

// Handle unhandled promise rejections
process.on('unhandledRejection', async (reason, promise) => {
  console.error(
    `[${new Date().toLocaleTimeString()}] Unhandled Rejection at:`,
    promise,
    'reason:',
    reason
  )

  if (isBrowserRelatedError(reason)) {
    console.error(
      '[Process] Browser-related rejection detected, allowing container restart...'
    )
    process.exit(1)
  }

  console.warn('[Process] Non-browser rejection logged, continuing...')
})
