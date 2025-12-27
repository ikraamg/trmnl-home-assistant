/**
 * Webhook Uploader Module
 *
 * Uploads screenshot images to TRMNL webhook endpoints via HTTP POST.
 * Handles custom headers, MIME type detection, and response logging.
 *
 * Protocol:
 * Uses HTTP POST with image binary data as request body.
 * Content-Type header set based on image format (png, jpeg, bmp).
 * Custom headers from schedule.webhook_headers merged with defaults.
 *
 * Error Handling Philosophy:
 * This command throws errors on failures (4xx, 5xx responses, network errors).
 * Caller (ScheduleExecutor) catches and logs but doesn't fail entire run.
 * Rationale: Screenshot captured successfully → webhook failure is non-critical.
 *
 * Response Logging:
 * Logs HTTP status, status text, and truncated response body (first 500 chars).
 * Prevents log spam from verbose webhook responses while preserving debugging info.
 *
 * TRMNL Integration:
 * TRMNL expects raw image data POSTed to webhook URL.
 * Successful upload updates e-ink display with new screenshot.
 * Response typically 200 OK with empty or JSON body.
 *
 * Network Retry:
 * Doesn't implement retries - handled by ScheduleExecutor's retry loop.
 * Network errors (DNS, connection refused, timeout) bubble up for retry.
 *
 * NOTE: Command doesn't save webhook URL response - just validates success.
 * AI: When modifying error handling, preserve throw behavior (don't swallow errors).
 *
 * @module lib/scheduler/webhook-uploader
 */

import {
  SCHEDULER_LOG_PREFIX,
  SCHEDULER_RESPONSE_BODY_TRUNCATE_LENGTH,
} from '../../const.js'

/**
 * Mapping of image file extensions to MIME types.
 *
 * Supported Formats:
 * - png → image/png (default, lossless)
 * - jpeg/jpg → image/jpeg (lossy compression)
 * - bmp → image/bmp (uncompressed, largest file size)
 *
 * NOTE: jpg and jpeg both map to same MIME type (aliases).
 */
const CONTENT_TYPES = {
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  bmp: 'image/bmp',
  png: 'image/png',
}

/**
 * Converts image format extension to HTTP Content-Type header value.
 *
 * Fallback Behavior:
 * Returns 'image/png' for unknown formats (safest default).
 * PNG is lossless and universally supported.
 *
 * Case Sensitivity:
 * Format should be lowercase (enforced by caller).
 * Mapping is case-sensitive - "PNG" won't match "png".
 *
 * @param {string} format - Image format extension (png, jpeg, bmp, etc.)
 * @returns {string} MIME type string (e.g., "image/png")
 */
function getContentType(format) {
  return CONTENT_TYPES[format] || 'image/png'
}

/**
 * Command for uploading screenshot images to TRMNL webhook endpoints.
 *
 * Request Structure:
 * - Method: POST
 * - Headers: Content-Type + optional custom headers from schedule config
 * - Body: Raw image buffer (binary data, not base64 or form-encoded)
 *
 * Custom Headers:
 * Schedule can specify webhook_headers object with arbitrary HTTP headers.
 * Example: {"Authorization": "Bearer token123", "X-Custom": "value"}
 * Headers are merged with Content-Type (custom headers can't override Content-Type).
 *
 * TRMNL Webhook Format:
 * TRMNL expects raw image bytes POSTed directly to webhook URL.
 * No JSON wrapping, no multipart/form-data, just pure image binary.
 * This is the simplest possible webhook format - just POST the image.
 *
 * Response Handling:
 * Reads response body as text and logs (truncated to prevent spam).
 * Throws error on non-2xx status codes (4xx, 5xx).
 * Caller decides whether to fail run or continue (graceful degradation).
 *
 * Logging Strategy:
 * Verbose logging for debugging webhook issues:
 * - Before: URL, Content-Type, payload size
 * - After: Status code, status text, truncated response body
 *
 * Error Propagation:
 * Throws errors for HTTP failures and network issues.
 * ScheduleExecutor catches these and decides retry strategy.
 *
 * @class
 */
export class UploadToWebhookCommand {
  #schedule
  #imageBuffer
  #format

  /**
   * Creates webhook upload command instance.
   *
   * @param {Object} schedule - Schedule with webhook_url and optional webhook_headers
   * @param {Buffer} imageBuffer - Screenshot image binary data
   * @param {string} format - Image format extension (png, jpeg, bmp)
   */
  constructor(schedule, imageBuffer, format) {
    this.#schedule = schedule
    this.#imageBuffer = imageBuffer
    this.#format = format
  }

  /**
   * Uploads screenshot to webhook via HTTP POST with comprehensive logging.
   *
   * Algorithm:
   * 1. Determine Content-Type from image format
   * 2. Log upload attempt (URL, Content-Type, size)
   * 3. POST image buffer with merged headers
   * 4. Read response body as text
   * 5. Log response (status, truncated body)
   * 6. Throw error if response not OK (status >= 400)
   * 7. Return success with status info
   *
   * Header Merging:
   * Spread operator merges custom headers with Content-Type.
   * Order matters: Content-Type comes after custom headers to override conflicts.
   * Example: {...custom, 'Content-Type': type} ensures CT can't be overridden.
   *
   * Response Body Handling:
   * Calls response.text() even for empty bodies (returns empty string).
   * Truncates to SCHEDULER_RESPONSE_BODY_TRUNCATE_LENGTH (500 chars).
   * Prevents log bloat from verbose webhook responses (error messages, JSON, etc.).
   *
   * Error Scenarios:
   * - Network errors: DNS, connection refused, timeout → thrown by fetch()
   * - HTTP errors: 4xx, 5xx → thrown after logging response
   * - Success: 2xx status → returns {success: true, ...}
   *
   * Fetch API:
   * Uses global fetch() (Node.js 18+) instead of node-fetch package.
   * Binary body support via Buffer (Uint8Array subclass).
   *
   * NOTE: Error messages include status code for retry logic classification.
   * AI: Don't suppress HTTP error throws - caller needs them for retry decisions.
   *
   * @returns {Promise<Object>} Result with {success: true, status: number, statusText: string}
   * @throws {Error} On HTTP errors (4xx, 5xx) or network failures
   */
  async call() {
    const contentType = getContentType(this.#format)

    console.log(
      `${SCHEDULER_LOG_PREFIX} Sending webhook to: ${
        this.#schedule.webhook_url
      }`
    )
    console.log(
      `${SCHEDULER_LOG_PREFIX} Content-Type: ${contentType}, Size: ${
        this.#imageBuffer.length
      } bytes`
    )

    const response = await fetch(this.#schedule.webhook_url, {
      method: 'POST',
      headers: {
        ...(this.#schedule.webhook_headers || {}),
        'Content-Type': contentType,
      },
      body: this.#imageBuffer,
    })

    const responseText = await response.text()
    console.log(
      `${SCHEDULER_LOG_PREFIX} Webhook response: ${response.status} ${response.statusText}`
    )
    if (responseText) {
      console.log(
        `${SCHEDULER_LOG_PREFIX} Response body: ${responseText.substring(
          0,
          SCHEDULER_RESPONSE_BODY_TRUNCATE_LENGTH
        )}`
      )
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    console.log(
      `${SCHEDULER_LOG_PREFIX} Uploaded to webhook: ${
        this.#schedule.webhook_url
      }`
    )

    return {
      success: true,
      status: response.status,
      statusText: response.statusText,
    }
  }
}
