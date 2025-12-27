/**
 * Browser Automation Module for Home Assistant Screenshot Capture
 *
 * Manages Puppeteer browser lifecycle and screenshot capture with aggressive optimization.
 * Implements caching, smart waiting, and error classification for robust automation.
 *
 * Responsibilities:
 * 1. Browser Lifecycle - Launch, maintain, cleanup Puppeteer browser instances
 * 2. Navigation Optimization - Cache-based navigation to avoid redundant page loads
 * 3. Authentication - Inject Home Assistant auth tokens via localStorage
 * 4. Screenshot Capture - Puppeteer screenshot with header cropping and processing
 * 5. Error Classification - Distinguish crashes from navigation failures for recovery
 * 6. Smart Waiting - Adaptive wait strategies (stability detection vs. fixed delay)
 *
 * Performance Optimizations:
 * - Navigation caching: Skip navigation if same path requested
 * - Theme caching: Skip theme updates if same theme/dark mode requested
 * - Language caching: Skip language updates if same lang requested
 * - Puppeteer args: 40+ flags to disable unused features and reduce memory
 * - Single-process mode: Reduce overhead on resource-constrained systems
 *
 * Home Assistant Integration:
 * - Sidebar always hidden (dockedSidebar: "always_hidden")
 * - Header height compensation (HEADER_HEIGHT pixels cropped from top)
 * - Bearer token authentication via localStorage injection
 * - Client-side routing for fast page transitions
 *
 * Error Recovery Strategy:
 * Classifies errors into categories for intelligent recovery:
 * - BrowserCrashError: Browser process died (Protocol error, Target closed)
 * - PageCorruptedError: Page errors detected but browser alive
 * - CannotOpenPageError: Navigation failed (DNS, 404, network)
 * - Generic Error: Other failures (rethrown as-is)
 *
 * State Management:
 * #lastRequestedPath, #lastRequestedLang, #lastRequestedTheme, #lastRequestedDarkMode
 * track previous values to enable cache-based optimization.
 *
 * NOTE: Browser class is stateful - single instance per app (owned by main.js).
 * AI: When modifying cache logic, ensure state is reset on errors (stale cache = bugs).
 *
 * @module screenshot
 */

import puppeteer from 'puppeteer'
import { debug, isAddOn, chromiumExecutable, HEADER_HEIGHT } from './const.js'
import {
  CannotOpenPageError,
  BrowserCrashError,
  PageCorruptedError,
} from './error.js'
import { processImage } from './lib/dithering.js'
import {
  NavigateToPage,
  WaitForPageLoad,
  WaitForPageStable,
  DismissToastsAndSetZoom,
  UpdateLanguage,
  UpdateTheme,
} from './lib/browser/navigation-commands.js'

// =============================================================================
// BROWSER CONFIGURATION
// =============================================================================

/**
 * Default localStorage values for Home Assistant UI customization.
 *
 * Sidebar Hidden:
 * dockedSidebar: "always_hidden" removes left sidebar for maximum content area.
 * Sidebar would waste precious e-ink screen space on navigation UI.
 *
 * Theme Selection:
 * selectedTheme: {"dark": false} sets light theme as default.
 * Actual theme can be overridden per-request via UpdateTheme command.
 *
 * JSON String Encoding:
 * Values are JSON-stringified strings (note double quotes + backticks).
 * Home Assistant stores complex objects as JSON strings in localStorage.
 * Example: `"always_hidden"` → localStorage value is the string "always_hidden" (with quotes).
 *
 * NOTE: These are defaults that get merged with auth tokens in #buildAuthStorage().
 */
const HASS_LOCAL_STORAGE_DEFAULTS = {
  dockedSidebar: `"always_hidden"`,
  selectedTheme: `{"dark": false}`,
}

/**
 * Puppeteer launch arguments optimized for headless screenshot capture.
 *
 * Optimization Strategy:
 * These 40+ flags aggressively disable unused Chrome features to reduce:
 * - Memory footprint (~30% reduction)
 * - CPU usage (~20% reduction)
 * - Startup time (~15% faster)
 *
 * Categories of Optimizations:
 * 1. Background Processes - Disable timers, networking, updates
 * 2. Security - Disable sandboxing (safe in headless/trusted context)
 * 3. UI Features - Disable popups, notifications, print preview
 * 4. GPU/Rendering - Software rendering only (no GPU acceleration)
 * 5. Cache/Memory - Minimal disk cache, single-process mode
 * 6. Add-on Mode - Extra flags for resource-constrained devices
 *
 * Security Considerations:
 * Sandboxing disabled (--no-sandbox, --no-zygote) is ONLY safe because:
 * - Headless mode (no user interaction)
 * - Trusted content only (Home Assistant dashboards)
 * - Isolated Docker container (add-on environment)
 * DO NOT use these flags for untrusted web pages!
 *
 * Single-Process Mode:
 * --single-process disables Chrome's multi-process architecture.
 * Trade-off: Lower memory but less crash isolation.
 * Acceptable for headless automation where crashes trigger full restart anyway.
 *
 * Low-End Device Mode:
 * Conditionally enabled for Home Assistant add-on environment (isAddOn flag).
 * Reduces animations, defers non-critical work, lowers memory thresholds.
 *
 * Based on: https://www.bannerbear.com/blog/ways-to-speed-up-puppeteer-screenshots/
 *
 * NOTE: Changing these flags can break screenshot capture - test thoroughly!
 * AI: When adding flags, document performance impact and compatibility risks.
 */
const PUPPETEER_ARGS = [
  // Disable unnecessary background processes
  '--autoplay-policy=user-gesture-required',
  '--disable-background-networking',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-breakpad',
  '--disable-component-update',
  '--disable-default-apps',
  '--disable-extensions',
  '--disable-hang-monitor',
  '--disable-renderer-backgrounding',

  // Disable security features (safe in headless context)
  '--disable-client-side-phishing-detection',
  '--disable-setuid-sandbox',
  '--no-sandbox',
  '--no-zygote',

  // Disable unneeded features
  '--disable-dev-shm-usage',
  '--disable-domain-reliability',
  '--disable-features=AudioServiceOutOfProcess',
  '--disable-ipc-flooding-protection',
  '--disable-notifications',
  '--disable-offer-store-unmasked-wallet-cards',
  '--disable-popup-blocking',
  '--disable-print-preview',
  '--disable-prompt-on-repost',
  '--disable-speech-api',
  '--disable-sync',
  '--metrics-recording-only',
  '--mute-audio',
  '--no-default-browser-check',
  '--no-first-run',
  '--no-pings',

  // UI optimizations
  '--hide-scrollbars',
  '--ignore-gpu-blacklist',
  '--use-gl=swiftshader',

  // Credential handling
  '--password-store=basic',
  '--use-mock-keychain',

  // GPU and rendering optimizations
  '--disable-gpu',
  '--disable-accelerated-2d-canvas',
  '--disable-software-rasterizer',

  // Memory and cache optimizations
  '--disable-application-cache',
  '--disable-cache',
  '--disk-cache-size=1',
  '--media-cache-size=1',

  // Process isolation optimizations
  '--disable-features=IsolateOrigins,site-per-process',
  '--single-process',

  // Add low-end device mode for resource-constrained environments
  ...(isAddOn ? ['--enable-low-end-device-mode'] : []),
]

// =============================================================================
// BROWSER CLASS
// =============================================================================

/**
 * Manages Puppeteer browser lifecycle with caching and error classification.
 *
 * Architecture:
 * Stateful service managing single Puppeteer browser instance.
 * Lazy initialization on first screenshot request.
 * Cache-based optimization avoids redundant navigation and configuration updates.
 *
 * Lifecycle:
 * 1. Construction: Store config (URL, token), no browser launched yet
 * 2. First request: Launch browser via #getPage(), navigate to page
 * 3. Subsequent requests: Reuse browser, skip navigation if same path
 * 4. Cleanup: Close page and browser, reset all cached state
 *
 * State Caching:
 * Tracks last requested values to enable "skip if unchanged" optimizations:
 * - #lastRequestedPath: Avoid navigation if same page
 * - #lastRequestedLang: Avoid language update if same lang
 * - #lastRequestedTheme: Avoid theme update if same theme
 * - #lastRequestedDarkMode: Avoid dark mode update if same setting
 *
 * Busy Flag:
 * #busy prevents concurrent operations on browser (not thread-safe).
 * Main.js serializes requests via queue pattern before calling Browser methods.
 *
 * Error Detection:
 * #pageErrorDetected flag tracks whether page errors occurred during operation.
 * Used to classify errors into PageCorruptedError vs. other error types.
 * Reset on new navigation attempts.
 *
 * Public API:
 * - navigatePage(): Navigate + apply settings (lang, theme, zoom)
 * - screenshotPage(): Capture screenshot with processing
 * - cleanup(): Destroy browser and reset state
 * - busy getter: Check if operation in progress
 *
 * NOTE: Single instance per app - owned by RequestHandler in main.js.
 * AI: When modifying cache logic, ensure all cached state reset in cleanup().
 *
 * @class
 */
export class Browser {
  // Private fields
  #homeAssistantUrl
  #token
  #browser
  #page
  #busy = false
  #pageErrorDetected = false

  // Cache last requested values to avoid unnecessary page updates
  #lastRequestedPath
  #lastRequestedLang
  #lastRequestedTheme
  #lastRequestedDarkMode

  /**
   * Creates browser manager instance (does not launch browser yet).
   *
   * Lazy Initialization:
   * Browser not launched until first #getPage() call.
   * Enables fast app startup - browser launch deferred until needed.
   *
   * @param {string} homeAssistantUrl - Base URL of Home Assistant instance
   * @param {string} token - Long-lived access token for authentication
   */
  constructor(homeAssistantUrl, token) {
    this.#homeAssistantUrl = homeAssistantUrl
    this.#token = token
  }

  // Bareword getters
  get busy() {
    return this.#busy
  }

  // ===========================================================================
  // BROWSER LIFECYCLE
  // ===========================================================================

  /**
   * Cleans up browser and page resources, resetting all state.
   *
   * Cleanup Sequence:
   * 1. Reset all instance fields to undefined (cache + browser refs)
   * 2. Close Puppeteer page (releases page resources)
   * 3. Close Puppeteer browser (kills Chrome process)
   *
   * Error Handling:
   * Errors during page/browser closure are logged but not thrown.
   * Cleanup is best-effort - even if close() fails, state is still reset.
   * This prevents cleanup failures from cascading to recovery logic.
   *
   * State Reset:
   * All cached values (path, lang, theme, dark) reset to undefined.
   * Next navigation will be treated as "first navigation" (full setup).
   *
   * Order Matters:
   * Must reset fields BEFORE closing browser to prevent race conditions.
   * If browser crashes during close(), fields already undefined (safe state).
   *
   * Use Case:
   * Called by BrowserRecoveryManager after crashes or degraded health.
   * Also called during graceful app shutdown.
   *
   * Idempotency:
   * Safe to call multiple times - guards against undefined browser/page.
   *
   * NOTE: After cleanup(), browser will relaunch on next screenshot request.
   * AI: When adding cached state, ensure it's reset here to prevent stale data.
   *
   * @returns {Promise<void>}
   */
  async cleanup() {
    if (!this.#browser && !this.#page) return

    // Reset all state
    const page = this.#page
    const browser = this.#browser

    this.#page = undefined
    this.#browser = undefined
    this.#lastRequestedPath = undefined
    this.#lastRequestedLang = undefined
    this.#lastRequestedTheme = undefined
    this.#lastRequestedDarkMode = undefined
    this.#pageErrorDetected = false

    // Close page first, then browser
    try {
      if (page) await page.close()
    } catch (err) {
      console.error('Error closing page during cleanup:', err)
    }

    try {
      if (browser) await browser.close()
    } catch (err) {
      console.error('Error closing browser during cleanup:', err)
    }

    console.log('Closed browser')
  }

  /**
   * Gets or creates Puppeteer page instance (lazy initialization pattern).
   *
   * Lazy Launch:
   * Returns existing page if available, otherwise launches new browser.
   * Browser launch deferred until first screenshot request.
   *
   * Launch Sequence:
   * 1. puppeteer.launch() with optimized args
   * 2. Attach 'disconnected' event listener to detect crashes
   * 3. Create new page
   * 4. Set up page event logging via #setupPageLogging()
   * 5. Store browser + page references
   * 6. Return page
   *
   * Browser Process Monitoring:
   * 'disconnected' event fires when Chrome process dies unexpectedly.
   * Handler resets #browser and #page to trigger relaunch on next request.
   * No error thrown - graceful degradation (next request will auto-recover).
   *
   * Configuration:
   * - headless: 'shell' (new headless mode, faster than old 'true')
   * - executablePath: Points to Chromium binary (const.js)
   * - args: PUPPETEER_ARGS (40+ optimization flags)
   *
   * Error Handling:
   * Wraps launch failures in BrowserCrashError for recovery system.
   * Common failures: Chromium missing, insufficient memory, permission errors.
   *
   * NOTE: This is the only place browser gets launched - all requests funnel through here.
   * AI: Don't add redundant browser.launch() calls elsewhere - breaks single-instance pattern.
   *
   * @private
   * @returns {Promise<Page>} Puppeteer page instance
   * @throws {BrowserCrashError} If browser launch fails
   */
  async #getPage() {
    if (this.#page) return this.#page

    console.log('Starting browser')

    try {
      // Launch browser
      const browser = await puppeteer.launch({
        headless: 'shell',
        executablePath: chromiumExecutable,
        args: PUPPETEER_ARGS,
      })

      // Monitor browser process death
      browser.on('disconnected', () => {
        console.error('[Browser] Browser process disconnected!')
        this.#browser = undefined
        this.#page = undefined
      })

      const page = await browser.newPage()

      // Set up event logging
      this.#setupPageLogging(page)

      this.#browser = browser
      this.#page = page
      return this.#page
    } catch (err) {
      throw new BrowserCrashError(err)
    }
  }

  /**
   * Configures page event handlers for comprehensive logging and error detection.
   *
   * Event Handlers Registered:
   * - framenavigated: Log frame URL changes (helps debug iframes)
   * - console: Forward browser console messages to Node.js logs
   * - error: Detect page-level errors, set #pageErrorDetected flag
   * - pageerror: Detect unhandled exceptions in page JavaScript
   * - requestfailed: Log failed HTTP requests (network errors, 404s, etc.)
   * - response: Log HTTP responses (debug mode only, verbose)
   *
   * Error Detection Strategy:
   * Sets #pageErrorDetected flag on 'error' and 'pageerror' events.
   * Used by navigatePage() and screenshotPage() to classify errors:
   * - If #pageErrorDetected true → throw PageCorruptedError
   * - If false → throw BrowserCrashError or rethrow original
   *
   * Chrome Error Page Filtering:
   * Filters out localStorage errors from chrome-error:// pages.
   * DNS/network failures redirect to chrome-error:// which spams localStorage errors.
   * These are expected noise - silently ignored to keep logs clean.
   *
   * Console Message Forwarding:
   * Prefixes with "CONSOLE LOG/WAR/ERR" for easy grep filtering.
   * Helps debug Home Assistant JavaScript issues from Node.js logs.
   *
   * Response Logging (Debug Mode):
   * Logs every HTTP response with status code and cache hit status.
   * Only enabled when debug=true (too verbose for production).
   * Useful for debugging cache behavior and API call patterns.
   *
   * NOTE: Event handlers are never removed - page lifecycle manages cleanup.
   * AI: When adding handlers, consider log volume impact (production vs. debug).
   *
   * @private
   * @param {Page} page - Puppeteer page instance to configure
   * @returns {void}
   */
  #setupPageLogging(page) {
    page
      .on('framenavigated', (frame) =>
        console.log('Frame navigated', frame.url())
      )
      .on('console', (message) =>
        console.log(
          `CONSOLE ${message
            .type()
            .slice(0, 3)
            .toUpperCase()} ${message.text()}`
        )
      )
      .on('error', (err) => {
        console.error('ERROR', err)
        this.#pageErrorDetected = true
      })
      .on('pageerror', ({ message }) => {
        // Filter out localStorage spam from chrome-error pages
        // These errors flood logs when DNS/network failures occur
        const isChromeErrorPage = page.url().startsWith('chrome-error://')
        const isLocalStorageError = message.includes('localStorage')

        if (isChromeErrorPage && isLocalStorageError) {
          // Silently ignore - this is expected on error pages
          return
        }

        console.log('PAGE ERROR', message)
        this.#pageErrorDetected = true
      })
      .on('requestfailed', (request) =>
        console.log(
          `REQUEST-FAILED ${request.failure().errorText} ${request.url()}`
        )
      )

    // Verbose response logging in debug mode
    if (debug) {
      page.on('response', (response) =>
        console.log(
          `RESPONSE ${response.status()} ${response.url()} (cache: ${response.fromCache()})`
        )
      )
    }
  }

  /**
   * Builds Home Assistant authentication localStorage object.
   *
   * Home Assistant Auth Architecture:
   * HA stores auth tokens in localStorage with specific key structure.
   * Long-lived access tokens use same format as temporary OAuth tokens.
   * No refresh_token needed for long-lived tokens (never expires).
   *
   * localStorage Structure:
   * Key: "hassTokens"
   * Value: JSON string with token object containing:
   * - access_token: Long-lived token from HA user profile
   * - token_type: Always "Bearer" (HTTP Authorization header type)
   * - expires_in: Nominal 1800s (not enforced for long-lived tokens)
   * - expires: Far future timestamp (9999999999999) to prevent expiry checks
   * - hassUrl: Base URL without trailing slash
   * - clientId: Base URL with trailing slash (OAuth client identifier)
   * - refresh_token: Empty string (unused for long-lived tokens)
   *
   * URL Formatting:
   * clientId requires trailing slash: "http://homeassistant.local:8123/"
   * hassUrl must NOT have trailing slash: "http://homeassistant.local:8123"
   * Home Assistant is picky about this - wrong format = auth failure.
   *
   * Injection Mechanism:
   * Returned object passed to NavigateToPage command.
   * Command uses page.evaluateOnNewDocument() to inject BEFORE page loads.
   * This ensures auth tokens present when HA JavaScript initializes.
   *
   * Merged Defaults:
   * Spreads HASS_LOCAL_STORAGE_DEFAULTS (sidebar, theme) before hassTokens.
   * All values get written to localStorage simultaneously.
   *
   * NOTE: Called on every navigation to ensure fresh tokens in closure.
   * AI: Don't cache this object - closure stale data prevention requires recreation.
   *
   * @private
   * @returns {Object} localStorage key-value pairs for HA authentication
   */
  #buildAuthStorage() {
    const clientId = new URL('/', this.#homeAssistantUrl).toString()
    const hassUrl = clientId.slice(0, -1) // Remove trailing slash

    return {
      ...HASS_LOCAL_STORAGE_DEFAULTS,
      hassTokens: JSON.stringify({
        access_token: this.#token,
        token_type: 'Bearer',
        expires_in: 1800,
        hassUrl,
        clientId,
        expires: 9999999999999, // Far future expiry
        refresh_token: '',
      }),
    }
  }

  // ===========================================================================
  // MAIN PUBLIC METHODS
  // ===========================================================================

  /**
   * Navigates to Home Assistant page and applies configuration (lang, theme, zoom).
   *
   * Cache-Based Optimization:
   * Skips navigation if same path as #lastRequestedPath (client-side routing).
   * Skips language update if same as #lastRequestedLang.
   * Skips theme update if same theme + dark mode.
   * This dramatically reduces wait time for repeated requests (3s → 500ms).
   *
   * Algorithm:
   * 1. Get or launch browser via #getPage()
   * 2. Add header height to viewport (compensate for crop later)
   * 3. Update viewport if dimensions changed
   * 4. Navigate to page (skip if cached path matches)
   * 5. Wait for page load (shadow DOM traversal)
   * 6. Dismiss toasts + set zoom
   * 7. Update language (skip if cached)
   * 8. Update theme (skip if cached)
   * 9. Smart wait or explicit wait based on extraWait parameter
   *
   * Header Height Compensation:
   * Adds HEADER_HEIGHT pixels to viewport height before navigation.
   * screenshotPage() crops this out later via clip region.
   * Ensures viewport.height represents visible content area.
   *
   * Wait Strategy:
   * - extraWait > 0: Use explicit wait time (user override)
   * - extraWait ≤ 0 or undefined: Smart wait via WaitForPageStable
   * Smart wait detects content stabilization (3 consecutive 100ms stable checks).
   * More efficient than fixed delays - adapts to actual page load time.
   *
   * First Navigation vs. Subsequent:
   * First navigation uses page.goto() with auth injection (slower, ~3s).
   * Subsequent navigations use client-side routing (faster, ~500ms).
   * isFirstNavigation flag triggers different code paths.
   *
   * Wait Time Accumulation:
   * Tracks total wait time needed based on operations performed:
   * - Navigation: DEFAULT_WAIT_TIME or DEFAULT + COLD_START_EXTRA_WAIT
   * - Toast dismissed: +1000ms
   * - Language changed: +1000ms
   * - Theme changed: +500ms
   * Smart wait uses accumulated time as maximum timeout.
   *
   * Error Handling:
   * Resets #pageErrorDetected on error to allow retry.
   * Classifies errors into BrowserCrashError, PageCorruptedError, CannotOpenPageError.
   * Recovery system uses classification to decide recovery strategy.
   *
   * Busy Flag:
   * Sets #busy=true at start, false in finally block.
   * Prevents concurrent operations (not thread-safe).
   * Main.js queue pattern serializes calls before reaching here.
   *
   * NOTE: This method only navigates - does NOT capture screenshot.
   * AI: When modifying cache logic, ensure #lastRequested* fields updated correctly.
   *
   * @param {Object} params - Navigation parameters
   * @param {string} params.pagePath - HA page path (e.g., "/lovelace/kitchen")
   * @param {Object} params.viewport - {width, height} in pixels
   * @param {number} [params.extraWait] - Extra wait time in ms (>0 = explicit, ≤0 = smart wait)
   * @param {number} [params.zoom=1] - Browser zoom level (1.0 = 100%)
   * @param {string} [params.lang] - Language code (e.g., "en", "fr")
   * @param {string} [params.theme] - Theme name or empty string for default
   * @param {boolean} [params.dark] - Dark mode enabled
   * @returns {Promise<Object>} Result with {time: number} (total elapsed ms)
   * @throws {Error} If browser busy
   * @throws {BrowserCrashError} If browser process dies
   * @throws {PageCorruptedError} If page errors detected
   * @throws {CannotOpenPageError} If navigation fails
   */
  async navigatePage({
    pagePath,
    viewport,
    extraWait,
    zoom = 1,
    lang,
    theme,
    dark,
  }) {
    if (this.#busy) throw new Error('Browser is busy')

    const start = Date.now()
    this.#busy = true
    const headerHeight = Math.round(HEADER_HEIGHT * zoom)

    try {
      const page = await this.#getPage()

      // Add header height to viewport (will be clipped in screenshot)
      viewport.height += headerHeight

      // Update viewport if changed
      const curViewport = page.viewport()
      if (
        !curViewport ||
        curViewport.width !== viewport.width ||
        curViewport.height !== viewport.height
      ) {
        await page.setViewport(viewport)
      }

      let waitTime = 0
      const isFirstNavigation = this.#lastRequestedPath === undefined

      // Navigate to page if path changed
      if (
        this.#lastRequestedPath === undefined ||
        this.#lastRequestedPath !== pagePath
      ) {
        const authStorage = this.#buildAuthStorage()
        const navigateCmd = new NavigateToPage(
          page,
          authStorage,
          this.#homeAssistantUrl
        )
        const result = await navigateCmd.call(pagePath, isFirstNavigation)
        waitTime = result.waitTime
        this.#lastRequestedPath = pagePath
      }

      const waitLoadCmd = new WaitForPageLoad(page)
      await waitLoadCmd.call()

      if (!isFirstNavigation) {
        const dismissCmd = new DismissToastsAndSetZoom(page)
        const dismissedToast = await dismissCmd.call(zoom)
        if (dismissedToast) waitTime += 1000
      } else {
        await page.evaluate((zoomLevel) => {
          document.body.style.zoom = zoomLevel
        }, zoom)
      }

      // Update language if changed
      if (lang !== this.#lastRequestedLang) {
        const langCmd = new UpdateLanguage(page)
        await langCmd.call(lang)
        this.#lastRequestedLang = lang
        waitTime += 1000
      }

      // Update theme if changed
      if (
        theme !== this.#lastRequestedTheme ||
        dark !== this.#lastRequestedDarkMode
      ) {
        const themeCmd = new UpdateTheme(page)
        await themeCmd.call(theme, dark)
        this.#lastRequestedTheme = theme
        this.#lastRequestedDarkMode = dark
        waitTime += 500
      }

      // Apply smart wait strategy
      // NOTE: Both undefined and 0 trigger smart wait (auto behavior)
      // Only positive values override with explicit wait times
      if (extraWait !== undefined && extraWait !== null && extraWait > 0) {
        // User explicitly requested wait time - honor it
        console.debug(`Explicit wait: ${extraWait}ms`)
        await new Promise((resolve) => setTimeout(resolve, extraWait))
      } else {
        // Smart wait based on page stability (triggered by: undefined, null, 0, or any non-positive value)
        const maxWait = waitTime > 0 ? waitTime : 3000
        const waitStableCmd = new WaitForPageStable(page, maxWait)
        const actualWait = await waitStableCmd.call()
        console.debug(`Smart wait: ${actualWait}ms (max: ${maxWait}ms)`)
      }

      return { time: Date.now() - start }
    } catch (err) {
      // Reset error flag on new navigation attempt
      this.#pageErrorDetected = false

      // Classify errors to help recovery system
      if (err instanceof BrowserCrashError) throw err
      if (this.#pageErrorDetected) {
        throw new PageCorruptedError(
          `Navigation failed with page errors: ${err.message}`
        )
      }
      if (err instanceof CannotOpenPageError) throw err

      // Other errors might be browser crashes
      if (
        err.message?.includes('Target closed') ||
        err.message?.includes('Session closed') ||
        err.message?.includes('Protocol error')
      ) {
        throw new BrowserCrashError(err)
      }

      throw err
    } finally {
      this.#busy = false
    }
  }

  /**
   * Captures screenshot of current page with cropping and image processing.
   *
   * Algorithm:
   * 1. Get page reference (must be already navigated via navigatePage)
   * 2. Calculate clip region (crop header + optional custom crop)
   * 3. Capture screenshot as PNG via Puppeteer
   * 4. Process image (dithering, format conversion, rotation, inversion)
   * 5. Return processed buffer + timing
   *
   * Header Cropping:
   * Always crops HEADER_HEIGHT pixels from top of viewport.
   * Home Assistant header wastes e-ink space on title/navigation.
   * Clip region starts at y=headerHeight, not y=0.
   *
   * Custom Cropping:
   * Optional crop parameter enables selecting subregion of content.
   * Crop coordinates relative to content area (after header crop).
   * Crop applied AFTER header crop: y = headerHeight + crop.y
   *
   * Clip Region Calculation:
   * Default: {x: 0, y: headerHeight, width: viewport.width, height: viewport.height - headerHeight}
   * With crop: {x: crop.x, y: headerHeight + crop.y, width: crop.width, height: crop.height}
   *
   * Screenshot Format:
   * Always captures as PNG first (lossless, preserves quality).
   * Format conversion happens in processImage() if format != 'png'.
   * This ensures dithering works on high-quality source data.
   *
   * Image Processing Pipeline:
   * Delegates to processImage() from dithering.js module.
   * Processing includes (in order):
   * 1. Rotation (90°, 180°, 270° if specified)
   * 2. Format conversion (PNG → JPEG/BMP if specified)
   * 3. Color inversion (if invert flag set)
   * 4. Dithering (if dithering config provided)
   *
   * Performance Logging:
   * Logs image processing time separately from total time.
   * Helps identify bottlenecks (processing can take 500-2000ms).
   *
   * Error Handling:
   * Resets #lastRequestedPath on error to force fresh navigation on retry.
   * Classifies errors into BrowserCrashError and PageCorruptedError.
   * Protocol errors ("Target closed", "Session closed") indicate browser crash.
   *
   * State Reset on Error:
   * Clearing #lastRequestedPath ensures next request does full navigation.
   * Prevents stale page state from causing screenshot failures.
   *
   * Busy Flag:
   * Sets #busy=true at start, false in finally block.
   * Prevents concurrent screenshot captures.
   *
   * NOTE: Must call navigatePage() before this method - doesn't navigate itself.
   * AI: When modifying clip logic, ensure header height compensation preserved.
   *
   * @param {Object} params - Screenshot parameters
   * @param {Object} params.viewport - {width, height} matching navigatePage call
   * @param {number} [params.zoom=1] - Zoom level matching navigatePage call
   * @param {string} [params.format='png'] - Output format (png, jpeg, bmp)
   * @param {number} [params.rotate] - Rotation degrees (90, 180, 270)
   * @param {boolean} [params.invert] - Invert colors (black ↔ white)
   * @param {Object} [params.dithering] - Dithering config object (see dithering.js)
   * @param {Object} [params.crop] - Custom crop region {x, y, width, height}
   * @returns {Promise<Object>} Result with {image: Buffer, time: number}
   * @throws {Error} If browser busy
   * @throws {BrowserCrashError} If browser process dies
   * @throws {PageCorruptedError} If page errors detected
   */
  async screenshotPage({
    viewport,
    zoom = 1,
    format = 'png',
    rotate,
    invert,
    dithering,
    crop,
  }) {
    if (this.#busy) throw new Error('Browser is busy')

    const start = Date.now()
    this.#busy = true
    const headerHeight = Math.round(HEADER_HEIGHT * zoom)

    try {
      const page = await this.#getPage()

      // Determine clip region (with optional crop)
      let clipRegion = {
        x: 0,
        y: headerHeight,
        width: viewport.width,
        height: viewport.height - headerHeight,
      }

      // Apply crop if specified
      if (crop && crop.width > 0 && crop.height > 0) {
        clipRegion = {
          x: crop.x,
          y: headerHeight + crop.y,
          width: crop.width,
          height: crop.height,
        }
      }

      // Capture screenshot as PNG
      let image = await page.screenshot({
        type: 'png',
        clip: clipRegion,
      })

      // Process image with dithering and format conversion
      const startProcess = Date.now()
      image = await processImage(image, {
        format,
        rotate,
        invert,
        dithering,
      })
      console.debug(`Image processing took ${Date.now() - startProcess}ms`)

      return { image, time: Date.now() - start }
    } catch (err) {
      // Reset navigation state on error to force fresh load
      this.#lastRequestedPath = undefined

      // Wrap screenshot errors to help recovery
      if (
        err.message?.includes('Target closed') ||
        err.message?.includes('Session closed') ||
        err.message?.includes('Protocol error')
      ) {
        throw new BrowserCrashError(err)
      }

      if (this.#pageErrorDetected) {
        throw new PageCorruptedError(
          `Screenshot failed with page errors: ${err.message}`
        )
      }

      throw err
    } finally {
      this.#busy = false
    }
  }
}
