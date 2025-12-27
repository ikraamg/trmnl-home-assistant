/**
 * Shared Puppeteer test utilities
 * @module tests/helpers/puppeteer-helper
 */

import { Browser } from '../../screenshot.js'

/**
 * Creates a test Browser instance pointing to mock HA
 * @param {string} [url='http://localhost:8123'] - Mock HA URL
 * @param {string} [token='mock-token-for-testing'] - Mock auth token
 * @returns {Browser} Browser instance for testing
 */
export function createTestBrowser(
  url = 'http://localhost:8123',
  token = 'mock-token-for-testing'
) {
  return new Browser(url, token)
}

/**
 * Waits for mock HA page to be fully loaded
 * Matches the exact checks from screenshot.js:244-266
 * @param {import('puppeteer').Page} page - Puppeteer page
 * @param {number} [timeout=10000] - Maximum wait time in milliseconds
 * @returns {Promise<void>}
 */
export async function waitForMockReady(page, timeout = 10000) {
  // Wait for home-assistant element
  await page.waitForSelector('home-assistant', { timeout })

  // Wait for the full shadow DOM structure to be ready
  await page.waitForFunction(
    () => {
      // eslint-disable-next-line no-undef
      const haEl = document.querySelector('home-assistant')
      if (!haEl || !haEl.shadowRoot) return false

      const mainEl = haEl.shadowRoot.querySelector('home-assistant-main')
      if (!mainEl || !mainEl.shadowRoot) return false

      const panelResolver = mainEl.shadowRoot.querySelector(
        'partial-panel-resolver'
      )
      if (!panelResolver) return false

      // Check that loading is complete
      return panelResolver._loading === false
    },
    { timeout }
  )
}

/**
 * Takes a test screenshot and validates basic properties
 * @param {Browser} browser - Browser instance
 * @param {Object} params - Screenshot parameters
 * @returns {Promise<Buffer>} Screenshot buffer
 */
export async function takeTestScreenshot(browser, params) {
  await browser.navigatePage(params)
  const result = await browser.screenshotPage(params)
  return result.image
}

// NOTE: Image validation utilities have been moved to image-helper.js
// Import them from there instead:
// import { getImageFormat, assertValidImage, validateImageMagic } from './image-helper.js'
