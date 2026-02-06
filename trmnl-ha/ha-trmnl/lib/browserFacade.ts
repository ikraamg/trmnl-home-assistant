/**
 * Browser Facade - Unified browser lifecycle management
 *
 * Combines health monitoring and crash recovery into single class.
 *
 * @module lib/browserFacade
 */

import { BrowserRecoveryFailedError } from '../error.js'
import { browserLogger } from './logger.js'

const log = browserLogger()

/** Browser instance interface (from screenshot.ts) */
export interface BrowserInstance {
  cleanup(): Promise<void>
  triggerInit(): Promise<void>
  isConnected(): boolean
}

/** Health check result */
export interface HealthCheckResult {
  healthy: boolean
  reason?: string
}

/** Combined stats for monitoring */
export interface BrowserStats {
  lastSuccessfulRequest: string
  timeSinceSuccess: number
  consecutiveFailures: number
  totalRecoveries: number
  recovering: boolean
}

/** Options for configuring BrowserFacade behavior */
export interface BrowserFacadeOptions {
  /** Base delay for exponential backoff in ms (default: 1000) */
  backoffBase?: number
  /** Maximum backoff delay in ms (default: 30000) */
  backoffMax?: number
}

/**
 * Unified browser health monitoring and crash recovery.
 */
export class BrowserFacade {
  #browser: BrowserInstance
  #lastSuccess = Date.now()
  #failures = 0
  #recoveries = 0
  #recovering = false
  #backoffBase: number
  #backoffMax: number

  static readonly MAX_FAILURES = 3
  static readonly STALE_MS = 300000 // 5 min
  static readonly MAX_RECOVERY_ATTEMPTS = 5

  constructor(browser: BrowserInstance, options: BrowserFacadeOptions = {}) {
    this.#browser = browser
    this.#backoffBase = options.backoffBase ?? 1000
    this.#backoffMax = options.backoffMax ?? 30000
  }

  recordSuccess(): void {
    this.#lastSuccess = Date.now()
    this.#failures = 0
  }

  recordFailure(): boolean {
    this.#failures++
    return this.#failures >= BrowserFacade.MAX_FAILURES
  }

  checkHealth(): HealthCheckResult {
    if (this.#failures >= BrowserFacade.MAX_FAILURES) {
      return {
        healthy: false,
        reason: `${this.#failures} consecutive failures`,
      }
    }
    const stale = Date.now() - this.#lastSuccess
    if (stale > BrowserFacade.STALE_MS && this.#failures > 0) {
      return {
        healthy: false,
        reason: `No success in ${Math.floor(stale / 1000)}s`,
      }
    }
    return { healthy: true }
  }

  async recover(): Promise<void> {
    if (this.#recovering) {
      while (this.#recovering) await this.#delay(500)
      return
    }

    this.#recovering = true
    let attempts = 0
    let lastError: Error | null = null

    log.info`Starting browser recovery...`

    try {
      while (attempts < BrowserFacade.MAX_RECOVERY_ATTEMPTS) {
        attempts++
        log.info`Recovery attempt ${attempts}/${BrowserFacade.MAX_RECOVERY_ATTEMPTS}`

        try {
          await this.#browser.cleanup().catch(() => {})
          if (attempts > 1) await this.#delay(this.#backoff(attempts - 1))
          await this.#browser.triggerInit()

          if (!this.#browser.isConnected()) throw new Error('Not connected')

          log.info`Recovery success after ${attempts} attempt(s)`
          this.#recoveries++
          this.#failures = 0
          return
        } catch (err) {
          lastError = err as Error
          log.error`Recovery attempt ${attempts} failed: ${lastError.message}`
        }
      }
      throw new BrowserRecoveryFailedError(
        BrowserFacade.MAX_RECOVERY_ATTEMPTS,
        lastError!
      )
    } finally {
      this.#recovering = false
    }
  }

  getStats(): BrowserStats {
    return {
      lastSuccessfulRequest: new Date(this.#lastSuccess).toISOString(),
      timeSinceSuccess: Date.now() - this.#lastSuccess,
      consecutiveFailures: this.#failures,
      totalRecoveries: this.#recoveries,
      recovering: this.#recovering,
    }
  }

  #backoff(attempt: number): number {
    return Math.min(this.#backoffBase * 2 ** attempt, this.#backoffMax)
  }

  #delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms))
  }
}
