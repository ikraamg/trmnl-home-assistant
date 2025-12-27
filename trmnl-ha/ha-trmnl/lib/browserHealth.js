/**
 * Browser Health Monitor
 *
 * Detects zombie browsers, crashed pages, and triggers recovery
 * AI: This module monitors browser health without blocking requests
 *
 * @module browserHealth
 */

/**
 * Health check result
 * @typedef {Object} HealthCheckResult
 * @property {boolean} healthy - Whether browser is healthy
 * @property {string} [reason] - Reason for unhealthy status
 * @property {Object} [metrics] - Health metrics
 */

/**
 * Monitors browser health through passive metrics and active checks
 * @class
 */
export class BrowserHealthMonitor {
  constructor() {
    this.lastSuccessfulRequest = Date.now();
    this.consecutiveFailures = 0;
    this.totalRecoveries = 0;

    // NOTE: Conservative thresholds - better safe than zombie
    this.MAX_CONSECUTIVE_FAILURES = 3; // Trigger recovery after 3 failures in a row
    this.STALE_THRESHOLD = 300000; // 5 minutes without successful request = suspicious
  }

  /**
   * Record successful browser operation
   * Resets failure counters and updates last success time
   */
  recordSuccess() {
    this.lastSuccessfulRequest = Date.now();
    this.consecutiveFailures = 0;
  }

  /**
   * Record failed browser operation
   * @returns {boolean} Whether recovery should be triggered
   */
  recordFailure() {
    this.consecutiveFailures++;
    return this.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES;
  }

  /**
   * Record recovery attempt
   * Increments recovery counter and resets failures
   */
  recordRecovery() {
    this.totalRecoveries++;
    this.consecutiveFailures = 0;
  }

  /**
   * Check if browser appears healthy based on recent activity
   * AI: This is a passive check - doesn't interact with browser
   *
   * @returns {HealthCheckResult}
   */
  checkHealth() {
    const timeSinceSuccess = Date.now() - this.lastSuccessfulRequest;

    if (this.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
      return {
        healthy: false,
        reason: `${this.consecutiveFailures} consecutive failures`,
        metrics: { consecutiveFailures: this.consecutiveFailures },
      };
    }

    // NOTE: Only flag as stale if we've had failures too
    // (Idle system with no requests is fine)
    if (
      timeSinceSuccess > this.STALE_THRESHOLD &&
      this.consecutiveFailures > 0
    ) {
      return {
        healthy: false,
        reason: `No successful request in ${Math.floor(timeSinceSuccess / 1000)}s`,
        metrics: { timeSinceSuccess },
      };
    }

    return {
      healthy: true,
      metrics: {
        timeSinceSuccess,
        consecutiveFailures: this.consecutiveFailures,
        totalRecoveries: this.totalRecoveries,
      },
    };
  }

  /**
   * Perform active health check on browser instance
   * AI: This actually pokes the browser to see if it responds
   *
   * @param {import('puppeteer').Browser} browser - Browser instance to check
   * @returns {Promise<HealthCheckResult>}
   */
  async checkBrowserAlive(browser) {
    if (!browser) {
      return {
        healthy: false,
        reason: "Browser instance is null/undefined",
      };
    }

    try {
      // Quick check: Can we get the process?
      const process = browser.process();
      if (!process || process.killed) {
        return {
          healthy: false,
          reason: "Browser process is dead",
        };
      }

      // Medium check: Can we get browser version?
      const version = await Promise.race([
        browser.version(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Timeout")), 2000)
        ),
      ]);

      return {
        healthy: true,
        metrics: { version },
      };
    } catch (err) {
      return {
        healthy: false,
        reason: `Browser unresponsive: ${err.message}`,
      };
    }
  }

  /**
   * Get health statistics for monitoring/debugging
   * @returns {Object} Current health statistics
   */
  getStats() {
    return {
      lastSuccessfulRequest: new Date(this.lastSuccessfulRequest).toISOString(),
      timeSinceSuccess: Date.now() - this.lastSuccessfulRequest,
      consecutiveFailures: this.consecutiveFailures,
      totalRecoveries: this.totalRecoveries,
    };
  }
}
