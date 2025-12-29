/**
 * Browser Navigation Commands - Home Assistant Page Automation
 *
 * Encapsulates all browser navigation and page manipulation operations for Home Assistant.
 * Uses Command Pattern - each class is a single-purpose command with .call() method.
 *
 * @module lib/browser/navigation-commands
 */

import type { Page } from 'puppeteer'
import {
  isAddOn,
  DEFAULT_WAIT_TIME,
  COLD_START_EXTRA_WAIT,
} from '../../const.js'
import { CannotOpenPageError } from '../../error.js'
import type { NavigationResult } from '../../types/domain.js'

/** Auth storage for localStorage injection */
export type AuthStorage = Record<string, string>

/**
 * Navigates to Home Assistant pages with authentication injection and client-side routing.
 *
 * Two Navigation Modes:
 * 1. First Navigation: Injects auth tokens via evaluateOnNewDocument(), then page.goto()
 * 2. Subsequent Navigation: Uses client-side router (real HA) or page.goto() (mock HA)
 */
export class NavigateToPage {
  #page: Page
  #authStorage: AuthStorage
  #homeAssistantUrl: string

  constructor(page: Page, authStorage: AuthStorage, homeAssistantUrl: string) {
    this.#page = page
    this.#authStorage = authStorage
    this.#homeAssistantUrl = homeAssistantUrl
  }

  /**
   * Navigates to specified page path.
   *
   * @param pagePath - Page path relative to HA base (e.g., "/lovelace/kitchen")
   * @param isFirstNavigation - True for first navigation (inject auth)
   * @returns Recommended wait time in milliseconds
   * @throws CannotOpenPageError If navigation fails
   */
  async call(
    pagePath: string,
    isFirstNavigation: boolean = false
  ): Promise<NavigationResult> {
    if (isFirstNavigation) {
      return this.#firstNavigation(pagePath)
    } else {
      return this.#subsequentNavigation(pagePath)
    }
  }

  async #firstNavigation(pagePath: string): Promise<NavigationResult> {
    const evaluateId = await this.#page.evaluateOnNewDocument(
      (storage: AuthStorage) => {
        for (const [key, value] of Object.entries(storage)) {
          localStorage.setItem(key, value)
        }
      },
      this.#authStorage
    )

    const pageUrl = new URL(pagePath, this.#homeAssistantUrl).toString()

    let response
    try {
      response = await this.#page.goto(pageUrl)
    } catch (err) {
      this.#page.removeScriptToEvaluateOnNewDocument(evaluateId.identifier)
      throw new CannotOpenPageError(0, pageUrl, (err as Error).message)
    }

    if (!response?.ok()) {
      this.#page.removeScriptToEvaluateOnNewDocument(evaluateId.identifier)
      throw new CannotOpenPageError(response?.status() ?? 0, pageUrl)
    }

    this.#page.removeScriptToEvaluateOnNewDocument(evaluateId.identifier)

    return {
      waitTime: DEFAULT_WAIT_TIME + (isAddOn ? COLD_START_EXTRA_WAIT : 0),
    }
  }

  async #subsequentNavigation(pagePath: string): Promise<NavigationResult> {
    const isMockHA = this.#page.url().includes('localhost:8123')

    if (isMockHA) {
      const pageUrl = new URL(pagePath, this.#homeAssistantUrl).toString()

      let response
      try {
        response = await this.#page.goto(pageUrl)
      } catch (err) {
        throw new CannotOpenPageError(0, pageUrl, (err as Error).message)
      }

      if (!response?.ok()) {
        throw new CannotOpenPageError(response?.status() ?? 0, pageUrl)
      }
    } else {
      // Real HA: Use client-side navigation
      await this.#page.evaluate((path: string) => {
        const state = history.state as { root?: boolean } | null
        history.replaceState(
          state?.root ? { root: true } : null,
          '',
          path
        )
        const event = new Event('location-changed') as Event & {
          detail?: { replace: boolean }
        }
        event.detail = { replace: true }
        window.dispatchEvent(event)
      }, pagePath)
    }

    return { waitTime: DEFAULT_WAIT_TIME }
  }
}

/**
 * Waits for Home Assistant page to finish loading by checking shadow DOM loading flags.
 */
export class WaitForPageLoad {
  #page: Page

  constructor(page: Page) {
    this.#page = page
  }

  async call(): Promise<void> {
    try {
      await this.#page.waitForFunction(
        () => {
          const haEl = document.querySelector('home-assistant')
          if (!haEl) return false

          const mainEl = (haEl as Element & { shadowRoot: ShadowRoot | null })
            .shadowRoot?.querySelector('home-assistant-main')
          if (!mainEl) return false

          const panelResolver = (
            mainEl as Element & { shadowRoot: ShadowRoot | null }
          ).shadowRoot?.querySelector('partial-panel-resolver') as
            | (Element & { _loading?: boolean })
            | null
          if (!panelResolver || panelResolver._loading) return false

          const panel = panelResolver.children[0] as
            | (Element & { _loading?: boolean })
            | undefined
          if (!panel) return false

          return !('_loading' in panel) || !panel._loading
        },
        { timeout: 10000, polling: 100 }
      )
    } catch (_err) {
      console.log('Timeout waiting for HA to finish loading')
    }
  }
}

/** Page stability metrics */
interface StabilityMetrics {
  height: number
  contentHash: number
}

/**
 * Smart wait strategy that detects when page content stops changing.
 */
export class WaitForPageStable {
  #page: Page
  #timeout: number

  constructor(page: Page, timeout: number = 5000) {
    this.#page = page
    this.#timeout = timeout
  }

  /**
   * Waits for content stabilization or timeout.
   * @returns Actual wait time in milliseconds
   */
  async call(): Promise<number> {
    const start = Date.now()
    let lastHeight = 0
    let lastContent = 0
    let stableChecks = 0
    const requiredStableChecks = 3

    while (Date.now() - start < this.#timeout) {
      const metrics = await this.#page.evaluate((): StabilityMetrics => {
        const haEl = document.querySelector('home-assistant')
        if (!haEl) return { height: 0, contentHash: 0 }

        return {
          height: document.body.scrollHeight,
          contentHash: haEl.shadowRoot?.innerHTML?.length || 0,
        }
      })

      if (
        metrics.height === lastHeight &&
        metrics.contentHash === lastContent
      ) {
        stableChecks++
        if (stableChecks >= requiredStableChecks) {
          const actualWait = Date.now() - start
          console.debug(
            `Page stable after ${actualWait}ms (${stableChecks} checks)`
          )
          return actualWait
        }
      } else {
        stableChecks = 0
      }

      lastHeight = metrics.height
      lastContent = metrics.contentHash

      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    const actualWait = Date.now() - start
    console.debug(`Page stability timeout after ${actualWait}ms`)
    return actualWait
  }
}

/**
 * Dismisses HA notification toasts and sets browser zoom level.
 */
export class DismissToastsAndSetZoom {
  #page: Page

  constructor(page: Page) {
    this.#page = page
  }

  /**
   * Dismisses toasts and sets zoom.
   * @param zoom - Zoom level (1.0 = 100%)
   * @returns True if toast was dismissed
   */
  async call(zoom: number): Promise<boolean> {
    return this.#page.evaluate((zoomLevel: number) => {
      document.body.style.zoom = String(zoomLevel)

      const haEl = document.querySelector('home-assistant')
      if (!haEl) return false

      const notifyEl = haEl.shadowRoot?.querySelector('notification-manager') as
        | (Element & { shadowRoot: ShadowRoot | null })
        | null
      if (!notifyEl) return false

      const actionEl = notifyEl.shadowRoot?.querySelector(
        'ha-toast *[slot=action]'
      ) as HTMLElement | null
      if (!actionEl) return false

      actionEl.click()
      return true
    }, zoom)
  }
}

/**
 * Updates Home Assistant UI language setting.
 */
export class UpdateLanguage {
  #page: Page

  constructor(page: Page) {
    this.#page = page
  }

  async call(lang: string): Promise<void> {
    await this.#page.evaluate((newLang: string) => {
      const haEl = document.querySelector('home-assistant') as
        | (Element & { _selectLanguage?: (lang: string, reload: boolean) => void })
        | null
      haEl?._selectLanguage?.(newLang, false)
    }, lang || 'en')
  }
}

/**
 * Updates Home Assistant theme and dark mode settings.
 */
export class UpdateTheme {
  #page: Page

  constructor(page: Page) {
    this.#page = page
  }

  async call(theme: string, dark: boolean): Promise<void> {
    await this.#page.evaluate(
      ({ theme, dark }: { theme: string; dark: boolean }) => {
        const haEl = document.querySelector('home-assistant')
        haEl?.dispatchEvent(
          new CustomEvent('settheme', {
            detail: { theme, dark },
          })
        )
      },
      { theme: theme || '', dark }
    )
  }
}
