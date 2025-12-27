/**
 * Schedule Executor Module
 *
 * Orchestrates execution of a single scheduled screenshot capture and delivery.
 * Coordinates 5 commands in sequence with retry logic for network failures.
 *
 * Command Chain Pattern:
 * Execution follows strict order to ensure data integrity:
 * 1. ScreenshotParamsBuilder - Build screenshot request parameters
 * 2. screenshotFn() - Capture screenshot via browser automation
 * 3. SaveScreenshotCommand - Persist image to disk
 * 4. CleanupOldScreenshotsCommand - Remove old files to prevent disk bloat
 * 5. UploadToWebhookCommand - POST to TRMNL webhook (optional)
 *
 * Retry Strategy:
 * Only network errors trigger retries (DNS, connection refused, timeouts).
 * Browser crashes, invalid configs, or file I/O errors fail immediately.
 * Retries use fixed delay (SCHEDULER_RETRY_DELAY_MS) between attempts.
 *
 * Error Handling:
 * - Webhook failures are logged but don't fail the entire run (graceful degradation)
 * - Screenshot/save failures bubble up to caller (critical path)
 * - Cleanup failures are silent (non-critical operation)
 *
 * Design Pattern:
 * Uses dependency injection for screenshotFn and outputDir to enable testing
 * without real browser or file system access.
 *
 * NOTE: This class doesn't manage its own lifecycle - owned by Scheduler.
 * AI: When modifying command chain, preserve sequential order (dependencies exist).
 *
 * @module lib/scheduler/schedule-executor
 */

import { ScreenshotParamsBuilder } from './screenshot-params-builder.js'
import {
  SaveScreenshotCommand,
  CleanupOldScreenshotsCommand,
} from './screenshot-file-manager.js'
import { UploadToWebhookCommand } from './webhook-uploader.js'
import {
  SCHEDULER_LOG_PREFIX,
  SCHEDULER_MAX_RETRIES,
  SCHEDULER_RETRY_DELAY_MS,
  SCHEDULER_RETENTION_MULTIPLIER,
  SCHEDULER_IMAGE_FILE_PATTERN,
  isSchedulerNetworkError,
} from '../../const.js'
import { loadSchedules } from '../scheduleStore.js'

/**
 * Orchestrates schedule execution with command pattern and retry logic.
 *
 * Dependencies (Injected):
 * - screenshotFn: Function that captures screenshots (usually browser.takeScreenshot)
 * - outputDir: Directory path for saving captured images
 *
 * Internal Components:
 * - ScreenshotParamsBuilder: Converts schedule config to screenshot params
 *
 * Public API:
 * - call(schedule): Execute schedule with retries, returns {success, savedPath}
 *
 * Execution Flow:
 * call() → retry loop → #executeOnce() → 5 command chain → result
 *
 * @class
 */
export class ScheduleExecutor {
  #screenshotFn
  #outputDir
  #paramsBuilder

  /**
   * Creates executor instance with injected dependencies.
   *
   * @param {Function} screenshotFn - Screenshot capture function (async)
   * @param {string} outputDir - Output directory for saved screenshots
   */
  constructor(screenshotFn, outputDir) {
    this.#screenshotFn = screenshotFn
    this.#outputDir = outputDir
    this.#paramsBuilder = new ScreenshotParamsBuilder()
  }

  /**
   * Executes a schedule with automatic retry on network failures.
   *
   * Retry Strategy:
   * - Maximum attempts: SCHEDULER_MAX_RETRIES (default: 3)
   * - Retry condition: Network errors only (DNS, connection, timeout)
   * - Retry delay: Fixed SCHEDULER_RETRY_DELAY_MS between attempts
   * - Non-retryable errors: Browser crashes, invalid configs, file I/O failures
   *
   * Success Path:
   * Returns {success: true, savedPath: "/path/to/image.png"} on first successful attempt.
   * Logs total execution time for performance monitoring.
   *
   * Failure Path:
   * Throws error after exhausting retries or on non-retryable failures.
   * Logs detailed error messages including attempt counts.
   *
   * Performance:
   * Typical execution: 2-5 seconds (browser automation + image processing)
   * With retries: Can take up to 15+ seconds (3 attempts × 5s each)
   *
   * NOTE: This is the public entry point for schedule execution.
   * AI: Don't bypass retry logic - network failures are common in production.
   *
   * @param {Object} schedule - Schedule configuration object
   * @returns {Promise<Object>} Result object with {success: boolean, savedPath: string}
   * @throws {Error} After max retries or on non-retryable errors
   */
  async call(schedule) {
    const startTime = Date.now()
    console.log(`${SCHEDULER_LOG_PREFIX} Running: ${schedule.name}`)

    // Try with retries
    for (let attempt = 1; attempt <= SCHEDULER_MAX_RETRIES; attempt++) {
      try {
        const result = await this.#executeOnce(schedule)

        const duration = Date.now() - startTime
        console.log(
          `${SCHEDULER_LOG_PREFIX} Completed: ${schedule.name} in ${duration}ms`
        )

        return result
      } catch (err) {
        const shouldRetry = this.#shouldRetry(err, attempt)

        if (shouldRetry) {
          console.error(
            `${SCHEDULER_LOG_PREFIX} Network error on attempt ${attempt}/${SCHEDULER_MAX_RETRIES} for ${schedule.name}: ${err.message}`
          )
          console.log(
            `${SCHEDULER_LOG_PREFIX} Retrying in ${
              SCHEDULER_RETRY_DELAY_MS / 1000
            }s...`
          )
          await this.#delay(SCHEDULER_RETRY_DELAY_MS)
        } else {
          // Give up
          if (attempt === SCHEDULER_MAX_RETRIES) {
            console.error(
              `${SCHEDULER_LOG_PREFIX} Failed after ${SCHEDULER_MAX_RETRIES} attempts for ${schedule.name}: ${err.message}`
            )
          } else {
            console.error(
              `${SCHEDULER_LOG_PREFIX} Error running ${schedule.name}:`,
              err.message
            )
          }
          throw err
        }
      }
    }
  }

  /**
   * Executes schedule once through 5-command chain (no retries at this level).
   *
   * Command Chain (Sequential):
   * 1. Build Parameters - Convert schedule config to screenshot params
   * 2. Capture Screenshot - Browser automation via injected screenshotFn
   * 3. Save to Disk - Persist image buffer to output directory
   * 4. Cleanup Old Files - LRU deletion to prevent disk bloat
   * 5. Upload to Webhook - POST to TRMNL (optional, graceful failure)
   *
   * Command Dependencies:
   * Commands MUST run in order due to data dependencies:
   * - Save needs image buffer from screenshot
   * - Cleanup needs all schedules loaded to calculate retention
   * - Upload uses same image buffer as save
   *
   * Error Handling Strategy:
   * - Screenshot/save errors: Bubble up (critical path, fail entire execution)
   * - Cleanup errors: Silent fail (non-critical, logged only)
   * - Webhook errors: Logged but not thrown (graceful degradation)
   *
   * Retention Calculation:
   * Cleanup limit = (enabled schedules count) × RETENTION_MULTIPLIER
   * This ensures each schedule keeps ~MULTIPLIER recent images.
   *
   * NOTE: Called by retry loop in call() method - don't add retry logic here.
   * AI: Preserve command order - don't reorder or parallelize commands.
   *
   * @private
   * @param {Object} schedule - Schedule configuration to execute
   * @returns {Promise<Object>} Result with {success: true, savedPath: string}
   * @throws {Error} On screenshot, save, or parameter building failures
   */
  async #executeOnce(schedule) {
    // COMMAND 1: Build params
    const params = this.#paramsBuilder.call(schedule)

    // COMMAND 2: Take screenshot
    const imageBuffer = await this.#screenshotFn(params)

    // COMMAND 3: Save to disk
    const saveCmd = new SaveScreenshotCommand(
      this.#outputDir,
      schedule,
      imageBuffer,
      params.format
    )
    const saveResult = saveCmd.call()
    console.log(`${SCHEDULER_LOG_PREFIX} Saved: ${saveResult.outputPath}`)

    // COMMAND 4: Cleanup old files
    const schedules = loadSchedules()
    const enabledCount = schedules.filter((s) => s.enabled).length
    const maxFiles = enabledCount * SCHEDULER_RETENTION_MULTIPLIER

    const cleanupCmd = new CleanupOldScreenshotsCommand(
      this.#outputDir,
      maxFiles,
      SCHEDULER_IMAGE_FILE_PATTERN
    )
    const cleanupResult = cleanupCmd.call()

    if (cleanupResult.deletedCount > 0) {
      console.log(
        `${SCHEDULER_LOG_PREFIX} Cleanup: Deleted ${cleanupResult.deletedCount} old file(s)`
      )
    }

    // COMMAND 5: Upload to webhook if configured
    if (schedule.webhook_url) {
      console.log(
        `${SCHEDULER_LOG_PREFIX} Webhook URL: ${schedule.webhook_url}`
      )
      const uploadCmd = new UploadToWebhookCommand(
        schedule,
        imageBuffer,
        params.format
      )
      try {
        await uploadCmd.call()
      } catch (err) {
        console.error(
          `${SCHEDULER_LOG_PREFIX} Webhook upload failed:`,
          err.message
        )
        // Don't fail the entire run if webhook upload fails
      }
    }

    return { success: true, savedPath: saveResult.outputPath }
  }

  /**
   * Determines if error is retryable based on type and attempt count.
   *
   * Retry Decision:
   * Returns true only if BOTH conditions met:
   * 1. Error is a network error (DNS, connection, timeout)
   * 2. Haven't exhausted max retry attempts
   *
   * Network Error Detection:
   * Delegated to isSchedulerNetworkError() helper in const.js.
   * Checks error codes: ENOTFOUND, ECONNREFUSED, ETIMEDOUT, etc.
   *
   * Non-Retryable Errors:
   * - Browser crashes (EPIPE, ECONNRESET)
   * - Invalid configs (validation errors)
   * - File system errors (EACCES, ENOSPC)
   * - HTTP errors (404, 500, etc.)
   *
   * NOTE: Conservative retry policy - only retry transient network issues.
   * AI: Don't make retry logic more aggressive without user testing.
   *
   * @private
   * @param {Error} error - Error that occurred during execution
   * @param {number} attempt - Current attempt number (1-indexed)
   * @returns {boolean} True if should retry, false if should give up
   */
  #shouldRetry(error, attempt) {
    return isSchedulerNetworkError(error) && attempt < SCHEDULER_MAX_RETRIES
  }

  /**
   * Delays execution for specified milliseconds using Promise-based sleep.
   *
   * Implementation:
   * Wraps setTimeout in a Promise to enable async/await usage.
   * This is the standard pattern for async delays in JavaScript.
   *
   * Use Case:
   * Called between retry attempts to prevent hammering failed endpoints.
   * Fixed delay (no exponential backoff) for simplicity.
   *
   * @private
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise<void>} Resolves after delay completes
   */
  #delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
