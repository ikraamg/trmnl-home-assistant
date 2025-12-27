/**
 * Browser Recovery Manager
 *
 * Handles browser crash recovery with exponential backoff
 * AI: This keeps the HTTP server alive when browser fails
 *
 * @module browserRecovery
 */

import { BrowserRecoveryFailedError } from "../error.js";

/**
 * Manages browser recovery with exponential backoff and health validation
 * @class
 */
export class BrowserRecoveryManager {
  /**
   * @param {import('../screenshot.js').Browser} browser - Browser instance to manage
   * @param {import('./browserHealth.js').BrowserHealthMonitor} healthMonitor - Health monitor
   */
  constructor(browser, healthMonitor) {
    this.browser = browser;
    this.healthMonitor = healthMonitor;

    // Recovery state
    this.recovering = false;
    this.recoveryAttempts = 0;
    this.lastRecoveryTime = null;

    // Configuration
    this.MAX_RECOVERY_ATTEMPTS = 5;
    this.BACKOFF_BASE_MS = 1000; // Start with 1s delay
    this.BACKOFF_MAX_MS = 30000; // Cap at 30s
  }

  /**
   * Calculate exponential backoff delay
   * @param {number} attempt - Current attempt number (0-indexed)
   * @returns {number} Delay in milliseconds
   * @private
   */
  _calculateBackoff(attempt) {
    // Exponential: 1s, 2s, 4s, 8s, 16s, 30s (capped)
    const delay = Math.min(
      this.BACKOFF_BASE_MS * Math.pow(2, attempt),
      this.BACKOFF_MAX_MS
    );
    return delay;
  }

  /**
   * Attempt to recover browser from crash or corruption
   *
   * NOTE: This method is idempotent - safe to call multiple times
   * AI: Keep HTTP server running, just restart browser component
   *
   * @returns {Promise<void>}
   * @throws {BrowserRecoveryFailedError} If recovery fails after max attempts
   */
  async recover() {
    // Prevent concurrent recovery attempts
    if (this.recovering) {
      console.log("[Recovery] Already recovering, waiting...");
      // Wait for current recovery to finish
      while (this.recovering) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      return;
    }

    this.recovering = true;
    this.recoveryAttempts = 0;
    let lastError = null;

    console.log("[Recovery] Starting browser recovery...");

    try {
      while (this.recoveryAttempts < this.MAX_RECOVERY_ATTEMPTS) {
        this.recoveryAttempts++;

        try {
          console.log(
            `[Recovery] Attempt ${this.recoveryAttempts}/${this.MAX_RECOVERY_ATTEMPTS}`
          );

          // Step 1: Cleanup old browser (force cleanup, ignore errors)
          console.log("[Recovery] Cleaning up old browser instance...");
          try {
            await this.browser.cleanup();
          } catch (cleanupErr) {
            console.warn(
              "[Recovery] Cleanup error (ignoring):",
              cleanupErr.message
            );
          }

          // Step 2: Wait for backoff
          if (this.recoveryAttempts > 1) {
            const delay = this._calculateBackoff(this.recoveryAttempts - 1);
            console.log(`[Recovery] Waiting ${delay}ms before retry...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
          }

          // Step 3: Test browser can be created
          console.log("[Recovery] Testing browser initialization...");
          await this.browser.getPage();

          // Step 4: Verify browser is responsive
          console.log("[Recovery] Verifying browser health...");
          const healthCheck = await this.healthMonitor.checkBrowserAlive(
            this.browser.browser
          );

          if (!healthCheck.healthy) {
            throw new Error(`Health check failed: ${healthCheck.reason}`);
          }

          // SUCCESS!
          console.log(
            `[Recovery] Browser recovered successfully after ${this.recoveryAttempts} attempt(s)`
          );
          this.healthMonitor.recordRecovery();
          this.lastRecoveryTime = Date.now();
          this.recoveryAttempts = 0;
          return;
        } catch (err) {
          lastError = err;
          console.error(
            `[Recovery] Attempt ${this.recoveryAttempts} failed:`,
            err.message
          );
        }
      }

      // All attempts failed
      throw new BrowserRecoveryFailedError(
        this.MAX_RECOVERY_ATTEMPTS,
        lastError
      );
    } finally {
      this.recovering = false;
    }
  }

  /**
   * Check if recovery is currently in progress
   * @returns {boolean} True if recovery is in progress
   */
  isRecovering() {
    return this.recovering;
  }

  /**
   * Get recovery statistics for monitoring/debugging
   * @returns {Object} Current recovery statistics
   */
  getStats() {
    return {
      recovering: this.recovering,
      recoveryAttempts: this.recoveryAttempts,
      lastRecoveryTime: this.lastRecoveryTime
        ? new Date(this.lastRecoveryTime).toISOString()
        : null,
    };
  }
}
