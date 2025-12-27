/**
 * Custom error classes for the TRMNL HA add-on
 * @module error
 */

/**
 * Error thrown when a page cannot be opened in the browser
 * Used for navigation failures, 404s, DNS errors, or authentication issues
 * @class
 * @extends Error
 */
export class CannotOpenPageError extends Error {
  /**
   * @param {number} status - HTTP status code from failed navigation (0 for network errors)
   * @param {string} pagePath - The page path that failed to load
   * @param {string} [networkError] - Optional network error message (e.g., ERR_NAME_NOT_RESOLVED)
   */
  constructor(status, pagePath, networkError) {
    const message = networkError
      ? `Unable to open page: ${pagePath} (Network error: ${networkError})`
      : `Unable to open page: ${pagePath} (${status})`;
    super(message);
    this.status = status;
    this.pagePath = pagePath;
    this.networkError = networkError;
    this.name = "CannotOpenPageError";
  }
}

/**
 * Error thrown when browser process crashes or becomes unresponsive
 * Triggers browser recovery without crashing the HTTP server
 * @class
 * @extends Error
 */
export class BrowserCrashError extends Error {
  /**
   * @param {Error} originalError - The underlying error that caused the crash
   */
  constructor(originalError) {
    super(`Browser crashed: ${originalError.message}`);
    this.originalError = originalError;
    this.name = "BrowserCrashError";
  }
}

/**
 * Error thrown when page is corrupted or in bad state
 * Triggers full browser cleanup and restart
 * @class
 * @extends Error
 */
export class PageCorruptedError extends Error {
  /**
   * @param {string} reason - Description of why the page is considered corrupted
   */
  constructor(reason) {
    super(`Page corrupted: ${reason}`);
    this.name = "PageCorruptedError";
  }
}

/**
 * Error thrown when browser health check fails
 * Used by monitoring system to signal browser unhealthiness
 * @class
 * @extends Error
 */
export class BrowserHealthCheckError extends Error {
  /**
   * @param {string} reason - Description of the health check failure
   */
  constructor(reason) {
    super(`Browser health check failed: ${reason}`);
    this.name = "BrowserHealthCheckError";
  }
}

/**
 * Error thrown when browser recovery fails after max retries
 * Indicates a serious issue requiring process restart
 * @class
 * @extends Error
 */
export class BrowserRecoveryFailedError extends Error {
  /**
   * @param {number} attempts - Number of recovery attempts made
   * @param {Error} lastError - The last error encountered during recovery
   */
  constructor(attempts, lastError) {
    super(`Browser recovery failed after ${attempts} attempts: ${lastError.message}`);
    this.attempts = attempts;
    this.lastError = lastError;
    this.name = "BrowserRecoveryFailedError";
  }
}
