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
 * @module main
 */

import http from 'node:http'
import type { IncomingMessage, ServerResponse, Server } from 'node:http'
import { Browser, type NavigateParams, type ScreenshotCaptureParams } from './screenshot.js'
import {
  isAddOn,
  hassUrl,
  hassToken,
  keepBrowserOpen,
  BROWSER_TIMEOUT,
  MAX_SCREENSHOTS_BEFORE_RESTART,
  MAX_NEXT_REQUESTS,
} from './const.js'
import {
  CannotOpenPageError,
  BrowserCrashError,
  PageCorruptedError,
  BrowserHealthCheckError,
  BrowserRecoveryFailedError,
} from './error.js'
import { Scheduler } from './scheduler.js'
import { BrowserFacade } from './lib/browserFacade.js'
import { HttpRouter } from './lib/http-router.js'
import { ScreenshotParamsParser } from './lib/screenshot-params-parser.js'
import type { ScreenshotParams, ImageFormat } from './types/domain.js'

/** Pending request resolver function */
type PendingResolver = () => void

/**
 * Central request handler coordinating all HTTP requests and browser operations.
 */
class RequestHandler {
  #browser: Browser
  #router: HttpRouter
  #facade: BrowserFacade
  #paramsParser: ScreenshotParamsParser
  #busy: boolean = false
  #pending: PendingResolver[] = []
  #requestCount: number = 0
  #nextRequests: ReturnType<typeof setTimeout>[] = []
  #navigationTime: number = 0
  #lastAccess: Date = new Date()
  #browserCleanupTimer: ReturnType<typeof setTimeout> | undefined

  constructor(browser: Browser) {
    this.#browser = browser
    this.#facade = new BrowserFacade(browser)
    this.#router = new HttpRouter(this.#facade)
    this.#paramsParser = new ScreenshotParamsParser()
  }

  get busy(): boolean {
    return this.#busy
  }

  get router(): HttpRouter {
    return this.#router
  }

  // ===========================================================================
  // BROWSER LIFECYCLE MANAGEMENT
  // ===========================================================================

  /**
   * Checks if browser should be cleaned up due to inactivity.
   */
  #runBrowserCleanupCheck = async (): Promise<void> => {
    if (this.#busy) return

    const idleTime = Date.now() - this.#lastAccess.getTime()

    if (idleTime < BROWSER_TIMEOUT) {
      const remainingTime = BROWSER_TIMEOUT - idleTime
      this.#browserCleanupTimer = setTimeout(
        this.#runBrowserCleanupCheck,
        remainingTime + 100
      )
      return
    }

    await this.#browser.cleanup()
  }

  /**
   * Marks browser as accessed and resets cleanup timer.
   */
  #markBrowserAccessed(): void {
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
   */
  async #maybeCleanupAfterRequests(): Promise<void> {
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
   */
  async #ensureBrowserHealthy(): Promise<void> {
    const health = this.#facade.checkHealth()

    if (!health.healthy) {
      console.warn(`[Health] Browser unhealthy: ${health.reason}`)
      await this.#facade.recover()
    }
  }

  /**
   * Handles browser crash/corruption errors with automatic recovery.
   */
  async #handleBrowserError(err: Error, requestId: string | number): Promise<boolean> {
    const isBrowserError =
      err instanceof BrowserCrashError ||
      err instanceof PageCorruptedError ||
      err instanceof BrowserHealthCheckError

    if (!isBrowserError) return false

    console.error(
      requestId,
      `Browser error detected: ${err.name} - ${err.message}`
    )

    const shouldRecover = this.#facade.recordFailure()

    if (shouldRecover || err instanceof BrowserCrashError) {
      try {
        await this.#facade.recover()
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
   */
  async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const requestUrl = new URL(request.url || '/', 'http://localhost')

    const routed = await this.#router.route(request, response, requestUrl)
    if (routed) return

    await this.#handleScreenshotRequest(request, response, requestUrl)
  }

  /**
   * Handles screenshot requests with queue management.
   */
  async #handleScreenshotRequest(
    _request: IncomingMessage,
    response: ServerResponse,
    requestUrl: URL
  ): Promise<void> {
    const requestId = this.#requestCount
    const start = new Date()

    await this.#waitForQueue(requestId, start)
    this.#busy = true

    try {
      const params = this.#paramsParser.call(requestUrl)
      if (!params) return this.#sendError(response, 400, 'Invalid parameters')

      const navTime = await this.#navigateWithRecovery(params, requestId, response)
      if (navTime === null) return

      const image = await this.#captureWithRecovery(params, requestId, response)
      if (!image) return

      this.#sendImage(response, image, params.format)
      if (params.next) this.#scheduleNextRequest(requestId, params, start)
    } finally {
      this.#releaseQueue()
    }
  }

  /** Waits in queue if handler is busy */
  async #waitForQueue(requestId: number, start: Date): Promise<void> {
    if (!this.#busy) return
    console.log(requestId, 'Busy, waiting in queue')
    await new Promise<void>((resolve) => this.#pending.push(resolve))
    console.log(requestId, `Wait time: ${Date.now() - start.getTime()} ms`)
  }

  /** Releases queue lock and processes next request */
  #releaseQueue(): void {
    this.#busy = false
    this.#pending.shift()?.()
    this.#markBrowserAccessed()
  }

  /** Navigates to page with automatic recovery on failure */
  async #navigateWithRecovery(
    params: NavigateParams,
    requestId: number,
    response: ServerResponse
  ): Promise<number | null> {
    try {
      await this.#ensureBrowserHealthy()
      const result = await this.#browser.navigatePage(params)
      this.#facade.recordSuccess()
      this.#navigationTime = Math.max(this.#navigationTime, result.time)
      return result.time
    } catch (err) {
      return this.#handleNavigationError(err as Error, params, requestId, response)
    }
  }

  /** Handles navigation errors with recovery attempt */
  async #handleNavigationError(
    err: Error,
    params: NavigateParams,
    requestId: number,
    response: ServerResponse
  ): Promise<number | null> {
    if (err instanceof CannotOpenPageError) {
      this.#sendError(response, 404, `Cannot open page: ${err.message}`)
      return null
    }

    const recovered = await this.#handleBrowserError(err, requestId)
    if (!recovered) throw err

    return this.#retryNavigation(params, requestId, response)
  }

  /** Retries navigation after browser recovery */
  async #retryNavigation(
    params: NavigateParams,
    requestId: number,
    response: ServerResponse
  ): Promise<number | null> {
    console.log(requestId, 'Retrying navigation after recovery...')
    try {
      const result = await this.#browser.navigatePage(params)
      this.#facade.recordSuccess()
      return result.time
    } catch (retryErr) {
      console.error(requestId, 'Retry failed after recovery:', retryErr)
      this.#sendError(response, 503, 'Service temporarily unavailable')
      return null
    }
  }

  /** Captures screenshot with automatic recovery on failure */
  async #captureWithRecovery(
    params: ScreenshotCaptureParams,
    requestId: number,
    response: ServerResponse
  ): Promise<Buffer | null> {
    try {
      const result = await this.#browser.screenshotPage(params)
      this.#facade.recordSuccess()
      await this.#maybeCleanupAfterRequests()
      return result.image
    } catch (err) {
      return this.#handleCaptureError(err as Error, requestId, response)
    }
  }

  /** Handles screenshot capture errors */
  async #handleCaptureError(
    err: Error,
    requestId: number,
    response: ServerResponse
  ): Promise<null> {
    const recovered = await this.#handleBrowserError(err, requestId)
    if (recovered) {
      this.#sendError(response, 503, 'Screenshot failed - please retry')
    } else {
      throw err
    }
    return null
  }

  /** Sends error response */
  #sendError(response: ServerResponse, status: number, message: string): void {
    response.statusCode = status
    response.end(message)
  }

  /** Sends image response with proper headers */
  #sendImage(response: ServerResponse, image: Buffer, format: ImageFormat): void {
    response.writeHead(200, {
      'Content-Type': this.#getContentType(format),
      'Content-Length': image.length,
    })
    response.end(image)
  }

  /**
   * Maps image format to HTTP Content-Type header.
   */
  #getContentType(format: ImageFormat): string {
    if (format === 'jpeg') return 'image/jpeg'
    if (format === 'bmp') return 'image/bmp'
    return 'image/png'
  }

  /**
   * Schedules next request for preloading.
   */
  #scheduleNextRequest(requestId: number, params: ScreenshotParams, start: Date): void {
    const end = new Date()
    const requestTime = end.getTime() - start.getTime()
    const nextWaitTime =
      params.next! * 1000 - requestTime - this.#navigationTime - 1000

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
   * Prepares next request by preloading the page.
   */
  async #prepareNextRequest(requestId: number, params: ScreenshotParams): Promise<void> {
    if (this.#busy) {
      console.log('Busy, skipping next request')
      return
    }

    const nextRequestId = `${requestId}-next`
    this.#busy = true
    console.log(nextRequestId, 'Preparing next request')

    try {
      const navigateResult = await this.#browser.navigatePage({
        ...params,
        extraWait: 0,
      } as NavigateParams)
      console.debug(nextRequestId, `Navigated in ${navigateResult.time} ms`)
    } catch (err) {
      console.error(nextRequestId, 'Error preparing next request', err)
    } finally {
      this.#busy = false
      const resolve = this.#pending.shift()
      if (resolve) resolve()
      this.#markBrowserAccessed()
    }
  }

  /**
   * Public API for scheduler to take screenshots.
   */
  async takeScreenshot(params: ScreenshotParams): Promise<Buffer> {
    if (this.#busy) {
      await new Promise<void>((resolve) => this.#pending.push(resolve))
    }
    this.#busy = true

    try {
      await this.#ensureBrowserHealthy()
      await this.#browser.navigatePage(params as NavigateParams)
      const result = await this.#browser.screenshotPage(params as ScreenshotCaptureParams)
      this.#facade.recordSuccess()
      await this.#maybeCleanupAfterRequests()
      return result.image
    } catch (err) {
      const recovered = await this.#handleBrowserError(err as Error, '[Scheduler]')
      if (recovered) {
        await this.#browser.navigatePage(params as NavigateParams)
        const result = await this.#browser.screenshotPage(params as ScreenshotCaptureParams)
        this.#facade.recordSuccess()
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

const browser = new Browser(hassUrl, hassToken!)
const requestHandler = new RequestHandler(browser)
const scheduler = new Scheduler((params) =>
  requestHandler.takeScreenshot(params)
)

requestHandler.router.setScheduler(scheduler)

const port = 10000
const server: Server = http.createServer((request, response) =>
  requestHandler.handleRequest(request, response)
)
server.listen(port)

scheduler.start()

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
 */
function startMemoryMonitor(): void {
  const WARN_THRESHOLD = 700 * 1024 * 1024
  const EXIT_THRESHOLD = 900 * 1024 * 1024

  setInterval(() => {
    const usage = process.memoryUsage()
    const rss = usage.rss
    const rssMB = (rss / 1024 / 1024).toFixed(2)

    if (rss > EXIT_THRESHOLD) {
      console.error(
        `[Memory] CRITICAL: ${rssMB}MB / 1024MB - Exiting for restart`
      )
      process.exit(1)
    } else if (rss > WARN_THRESHOLD) {
      console.warn(`[Memory] WARNING: ${rssMB}MB / 1024MB`)
    }
  }, 30000)
}

/**
 * Simple log rotation - checks every 5 minutes
 */
async function startLogRotation(): Promise<void> {
  const { existsSync, statSync, renameSync, readdirSync, unlinkSync } =
    await import('node:fs')
  const path = await import('node:path')

  const LOG_DIR = './logs'
  const MAX_SIZE = 10 * 1024 * 1024
  const MAX_FILES = 3

  async function rotateLogsIfNeeded(): Promise<void> {
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

          const allFiles = readdirSync(LOG_DIR)
          const rotatedFiles = allFiles
            .filter((f) => f.startsWith(logFile) && f !== logFile)
            .map((f) => ({
              name: f,
              mtime: statSync(path.join(LOG_DIR, f)).mtime,
            }))
            .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())

          if (rotatedFiles.length > MAX_FILES) {
            rotatedFiles.slice(MAX_FILES).forEach((f) => {
              try {
                unlinkSync(path.join(LOG_DIR, f.name))
                console.log(`[LogRotate] Deleted old log: ${f.name}`)
              } catch (err) {
                console.error(
                  `[LogRotate] Error deleting ${f.name}: ${(err as Error).message}`
                )
              }
            })
          }
        } catch (err) {
          console.error(`[LogRotate] Error rotating ${logFile}: ${(err as Error).message}`)
        }
      }
    }
  }

  setInterval(rotateLogsIfNeeded, 5 * 60 * 1000)
  setTimeout(rotateLogsIfNeeded, 60000)
}

startMemoryMonitor()
startLogRotation()

// =============================================================================
// CRASH RECOVERY & GRACEFUL SHUTDOWN
// =============================================================================

/**
 * Checks if error is browser-related by message content or error type.
 */
function isBrowserRelatedError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const err = error as Error
  return (
    err.message?.includes('browser') ||
    err.message?.includes('chromium') ||
    err.message?.includes('puppeteer') ||
    error instanceof BrowserCrashError ||
    error instanceof PageCorruptedError
  )
}

/**
 * Graceful shutdown handler for SIGTERM and SIGINT signals.
 */
async function gracefulShutdown(signal: string): Promise<void> {
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

  setTimeout(() => {
    console.error(
      `[${new Date().toLocaleTimeString()}] Forced shutdown after timeout`
    )
    process.exit(1)
  }, 30000)
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

process.on('uncaughtException', async (err: Error) => {
  console.error(`[${new Date().toLocaleTimeString()}] Uncaught Exception:`, err)

  if (isBrowserRelatedError(err)) {
    console.error(
      '[Process] Browser-related crash detected, allowing container restart...'
    )
  }

  process.exit(1)
})

process.on('unhandledRejection', async (reason: unknown, promise: Promise<unknown>) => {
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
