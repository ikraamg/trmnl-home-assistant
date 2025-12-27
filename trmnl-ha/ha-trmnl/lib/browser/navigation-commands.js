/* global document, window, history */
/**
 * Browser Navigation Commands - Home Assistant Page Automation
 *
 * Encapsulates all browser navigation and page manipulation operations for Home Assistant.
 * Uses Command Pattern - each class is a single-purpose command with .call() method.
 *
 * Commands:
 * 1. NavigateToPage - Page navigation with authentication injection and client-side routing
 * 2. WaitForPageLoad - Shadow DOM traversal waiting for HA to finish loading
 * 3. WaitForPageStable - Smart content stabilization detection (more efficient than setTimeout)
 * 4. DismissToastsAndSetZoom - Dismisses notification toasts and applies browser zoom
 * 5. UpdateLanguage - Sets Home Assistant UI language
 * 6. UpdateTheme - Sets theme name and dark mode
 *
 * Home Assistant Architecture:
 * HA uses Web Components with Shadow DOM. Structure is:
 * <home-assistant>
 *   #shadow-root
 *     <home-assistant-main>
 *       #shadow-root
 *         <partial-panel-resolver>
 *           <ha-panel-*>  (actual dashboard content)
 *
 * Client-Side Routing:
 * Real HA uses client-side router (no page reloads). Navigate by dispatching
 * 'location-changed' event + updating history.replaceState(). Mock HA (used in tests)
 * doesn't have this router, so requires full page.goto().
 *
 * Authentication:
 * Auth tokens stored in localStorage. First navigation injects auth via
 * evaluateOnNewDocument() which runs BEFORE page loads. Subsequent navigations
 * reuse existing localStorage (auth persists in Puppeteer browser context).
 *
 * Wait Strategy Trade-offs:
 * - WaitForPageLoad: Fast but basic - checks shadow DOM loading flags
 * - WaitForPageStable: Slower but thorough - waits for content to stop changing
 * - Smart wait (screenshot.js): Tries WaitForPageStable, falls back to setTimeout
 *
 * NOTE: All commands use Puppeteer Page.evaluate() to run code in browser context.
 * AI: Shadow DOM requires .shadowRoot traversal - querySelector() won't find nested elements.
 *
 * @module lib/browser/navigation-commands
 */

import {
  isAddOn,
  DEFAULT_WAIT_TIME,
  COLD_START_EXTRA_WAIT,
} from '../../const.js'
import { CannotOpenPageError } from '../../error.js'

/**
 * Navigates to Home Assistant pages with authentication injection and client-side routing.
 *
 * Two Navigation Modes:
 * 1. First Navigation: Injects auth tokens via evaluateOnNewDocument(), then page.goto()
 * 2. Subsequent Navigation: Uses client-side router (real HA) or page.goto() (mock HA)
 *
 * First Navigation (Cold Start):
 * - Registers localStorage injection script BEFORE page loads
 * - Navigates with page.goto() - causes full page reload
 * - Cleans up injection script after navigation completes
 * - Returns longer wait time (DEFAULT + COLD_START_EXTRA_WAIT)
 *
 * Subsequent Navigation (Warm):
 * - Detects mock HA (localhost:8123) vs. real HA
 * - Mock HA: Full page.goto() reload (doesn't have client-side router)
 * - Real HA: Client-side navigation via 'location-changed' event (faster, no reload)
 * - Returns DEFAULT_WAIT_TIME only
 *
 * Client-Side Navigation (Real HA):
 * Simulates router.navigate() by:
 * 1. Update history.replaceState() with new path
 * 2. Dispatch 'location-changed' event with {replace: true}
 * 3. HA's router listens for this event and renders new panel
 *
 * Error Handling:
 * - DNS/network errors don't return response object - caught and wrapped
 * - HTTP errors (404, 500, etc.) - throw CannotOpenPageError with status code
 *
 * NOTE: Auth script cleanup is critical - prevents duplicate injections on retry.
 * AI: evaluateOnNewDocument() persists until removed - always clean up.
 *
 * @class
 */
export class NavigateToPage {
  #page
  #authStorage
  #homeAssistantUrl

  /**
   * Creates navigation command.
   *
   * @param {Page} page - Puppeteer page instance
   * @param {Object} authStorage - localStorage key-value pairs for HA auth
   * @param {string} homeAssistantUrl - Base URL of Home Assistant (e.g., "http://homeassistant.local:8123")
   */
  constructor(page, authStorage, homeAssistantUrl) {
    this.#page = page
    this.#authStorage = authStorage
    this.#homeAssistantUrl = homeAssistantUrl
  }

  /**
   * Navigates to specified page path.
   *
   * @param {string} pagePath - Page path relative to HA base (e.g., "/lovelace/kitchen")
   * @param {boolean} [isFirstNavigation=false] - True for first navigation (inject auth)
   * @returns {Promise<{waitTime: number}>} Recommended wait time in milliseconds
   * @throws {CannotOpenPageError} If navigation fails (DNS, HTTP errors)
   */
  async call(pagePath, isFirstNavigation = false) {
    if (isFirstNavigation) {
      return this.#firstNavigation(pagePath)
    } else {
      return this.#subsequentNavigation(pagePath)
    }
  }

  async #firstNavigation(pagePath) {
    // Inject auth before loading page
    const evaluateId = await this.#page.evaluateOnNewDocument((storage) => {
      for (const [key, value] of Object.entries(storage)) {
        localStorage.setItem(key, value)
      }
    }, this.#authStorage)

    const pageUrl = new URL(pagePath, this.#homeAssistantUrl).toString()

    let response
    try {
      response = await this.#page.goto(pageUrl)
    } catch (err) {
      // DNS/network errors don't return a response object
      // Examples: ERR_NAME_NOT_RESOLVED, ERR_CONNECTION_REFUSED, ERR_INTERNET_DISCONNECTED
      this.#page.removeScriptToEvaluateOnNewDocument(evaluateId.identifier)
      throw new CannotOpenPageError(0, pageUrl, err.message)
    }

    if (!response.ok()) {
      this.#page.removeScriptToEvaluateOnNewDocument(evaluateId.identifier)
      throw new CannotOpenPageError(response.status(), pageUrl)
    }

    this.#page.removeScriptToEvaluateOnNewDocument(evaluateId.identifier)

    return {
      waitTime: DEFAULT_WAIT_TIME + (isAddOn ? COLD_START_EXTRA_WAIT : 0),
    }
  }

  async #subsequentNavigation(pagePath) {
    // Check if using mock HA (which doesn't have client-side router)
    const isMockHA = this.#page.url().includes('localhost:8123')

    if (isMockHA) {
      // Mock HA doesn't have client-side router - do full page reload
      const pageUrl = new URL(pagePath, this.#homeAssistantUrl).toString()

      let response
      try {
        response = await this.#page.goto(pageUrl)
      } catch (err) {
        // DNS/network errors don't return a response object
        throw new CannotOpenPageError(0, pageUrl, err.message)
      }

      if (!response.ok()) {
        throw new CannotOpenPageError(response.status(), pageUrl)
      }
    } else {
      // Real HA: Use client-side navigation (faster, no reload)
      await this.#page.evaluate((path) => {
        history.replaceState(
          history.state?.root ? { root: true } : null,
          '',
          path
        )
        const event = new Event('location-changed')
        event.detail = { replace: true }
        window.dispatchEvent(event)
      }, pagePath)
    }

    return { waitTime: DEFAULT_WAIT_TIME }
  }
}

/**
 * Waits for Home Assistant page to finish loading by checking shadow DOM loading flags.
 *
 * Shadow DOM Traversal:
 * 1. home-assistant element (root)
 * 2. home-assistant-main (shadow child)
 * 3. partial-panel-resolver (checks _loading flag)
 * 4. First child panel (checks _loading flag if present)
 *
 * Loading Flags:
 * - partial-panel-resolver._loading: True while resolver loads panel
 * - panel._loading: True while panel loads content (optional flag)
 *
 * Timeout: 10 seconds, polls every 100ms. Timeout is logged but doesn't throw
 * (graceful degradation - allows screenshot even if load detection fails).
 *
 * @class
 */
export class WaitForPageLoad {
  #page

  /**
   * @param {Page} page - Puppeteer page instance
   */
  constructor(page) {
    this.#page = page
  }

  /**
   * Waits for HA page load or 10s timeout.
   *
   * @returns {Promise<void>}
   */
  async call() {
    try {
      await this.#page.waitForFunction(
        () => {
          const haEl = document.querySelector('home-assistant')
          if (!haEl) return false

          const mainEl = haEl.shadowRoot?.querySelector('home-assistant-main')
          if (!mainEl) return false

          const panelResolver = mainEl.shadowRoot?.querySelector(
            'partial-panel-resolver'
          )
          if (!panelResolver || panelResolver._loading) return false

          const panel = panelResolver.children[0]
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

/**
 * Smart wait strategy that detects when page content stops changing (more efficient than setTimeout).
 *
 * Stabilization Algorithm:
 * - Polls every 100ms checking scroll height + shadow DOM content length
 * - Requires 3 consecutive stable checks (300ms total) to declare stable
 * - Times out after 5 seconds (configurable)
 * - Returns actual wait time for logging/metrics
 *
 * Why This Works:
 * Dynamic content (charts, images, slow cards) causes height/content changes.
 * When both metrics stabilize for 300ms, content is likely fully rendered.
 * More efficient than arbitrary setTimeout - adapts to actual content load time.
 *
 * Content Hash:
 * Uses shadowRoot.innerHTML.length as cheap proxy for content changes.
 * Cheaper than hashing full HTML but still detects DOM mutations.
 *
 * NOTE: Used in screenshot.js smart wait strategy as first attempt before setTimeout fallback.
 *
 * @class
 */
export class WaitForPageStable {
  #page
  #timeout

  /**
   * @param {Page} page - Puppeteer page instance
   * @param {number} [timeout=5000] - Max wait time in milliseconds
   */
  constructor(page, timeout = 5000) {
    this.#page = page
    this.#timeout = timeout
  }

  /**
   * Waits for content stabilization or timeout.
   *
   * @returns {Promise<number>} Actual wait time in milliseconds
   */
  async call() {
    const start = Date.now()
    let lastHeight = 0
    let lastContent = 0
    let stableChecks = 0
    const requiredStableChecks = 3 // 3 consecutive stable checks (300ms total)

    while (Date.now() - start < this.#timeout) {
      const metrics = await this.#page.evaluate(() => {
        const haEl = document.querySelector('home-assistant')
        if (!haEl) return { height: 0, contentHash: 0 }

        return {
          height: document.body.scrollHeight,
          contentHash: haEl.shadowRoot?.innerHTML?.length || 0,
        }
      })

      // Check if both height and content length are stable
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
        stableChecks = 0 // Reset if changed
      }

      lastHeight = metrics.height
      lastContent = metrics.contentHash

      // Check every 100ms
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    const actualWait = Date.now() - start
    console.debug(`Page stability timeout after ${actualWait}ms`)
    return actualWait
  }
}

/**
 * Dismisses HA notification toasts and sets browser zoom level.
 *
 * Toast Dismissal:
 * Navigates shadow DOM to find notification-manager → ha-toast → action button.
 * Clicks action button to dismiss toast (if present). Fails silently if not found.
 *
 * Zoom:
 * Sets document.body.style.zoom which scales entire page. Used to fit more/less
 * content in viewport without changing viewport dimensions.
 *
 * NOTE: Toasts can obscure content in screenshots. This ensures clean captures.
 *
 * @class
 */
export class DismissToastsAndSetZoom {
  #page

  /**
   * @param {Page} page - Puppeteer page instance
   */
  constructor(page) {
    this.#page = page
  }

  /**
   * Dismisses toasts and sets zoom.
   *
   * @param {number} zoom - Zoom level (1.0 = 100%, 0.8 = 80%, 1.2 = 120%)
   * @returns {Promise<boolean>} True if toast was dismissed, false if not found
   */
  async call(zoom) {
    return this.#page.evaluate((zoomLevel) => {
      document.body.style.zoom = zoomLevel

      // Try to find and dismiss toast notification
      const haEl = document.querySelector('home-assistant')
      if (!haEl) return false

      const notifyEl = haEl.shadowRoot?.querySelector('notification-manager')
      if (!notifyEl) return false

      const actionEl = notifyEl.shadowRoot.querySelector(
        'ha-toast *[slot=action]'
      )
      if (!actionEl) return false

      actionEl.click()
      return true
    }, zoom)
  }
}

/**
 * Updates Home Assistant UI language setting.
 *
 * Calls HA's internal _selectLanguage() method which reloads translations
 * and re-renders UI strings. Second parameter (false) prevents full page reload.
 *
 * @class
 */
export class UpdateLanguage {
  #page

  /**
   * @param {Page} page - Puppeteer page instance
   */
  constructor(page) {
    this.#page = page
  }

  /**
   * Sets UI language.
   *
   * @param {string} lang - Language code (e.g., "en", "fr", "de")
   * @returns {Promise<void>}
   */
  async call(lang) {
    await this.#page.evaluate((newLang) => {
      document.querySelector('home-assistant')._selectLanguage(newLang, false)
    }, lang || 'en')
  }
}

/**
 * Updates Home Assistant theme and dark mode settings.
 *
 * Dispatches 'settheme' custom event that HA listens for. HA applies theme
 * CSS and dark mode class instantly without page reload.
 *
 * @class
 */
export class UpdateTheme {
  #page

  /**
   * @param {Page} page - Puppeteer page instance
   */
  constructor(page) {
    this.#page = page
  }

  /**
   * Sets theme and dark mode.
   *
   * @param {string} theme - Theme name (empty string for default theme)
   * @param {boolean} dark - True for dark mode, false for light mode
   * @returns {Promise<void>}
   */
  async call(theme, dark) {
    await this.#page.evaluate(
      ({ theme, dark }) => {
        document.querySelector('home-assistant').dispatchEvent(
          new CustomEvent('settheme', {
            detail: { theme, dark },
          })
        )
      },
      { theme: theme || '', dark }
    )
  }
}
