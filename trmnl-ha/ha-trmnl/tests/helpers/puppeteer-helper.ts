/**
 * Shared Puppeteer test utilities
 * @module tests/helpers/puppeteer-helper
 */

import type { Page } from 'puppeteer'
import { Browser, type NavigateParams, type ScreenshotCaptureParams } from '../../screenshot.js'
import { waitForHAReady } from '../../lib/browser/ha-elements.js'

/**
 * Creates a test Browser instance pointing to mock HA
 */
export function createTestBrowser(
  url: string = 'http://localhost:8123',
  token: string = 'mock-token-for-testing'
): Browser {
  return new Browser(url, token)
}

/**
 * Waits for mock HA page to be fully loaded.
 * Uses shared ha-elements helper for consistent HA DOM structure checks.
 */
export async function waitForMockReady(page: Page, timeout: number = 10000): Promise<void> {
  // Wait for home-assistant element first
  await page.waitForSelector('home-assistant', { timeout })

  // Wait for full shadow DOM structure using shared helper
  await waitForHAReady(page, timeout)
}

/** Navigation and screenshot params for testing */
interface TestScreenshotParams extends NavigateParams, ScreenshotCaptureParams {}

/**
 * Takes a test screenshot and validates basic properties
 */
export async function takeTestScreenshot(
  browser: Browser,
  params: TestScreenshotParams
): Promise<Buffer> {
  await browser.navigatePage(params)
  const result = await browser.screenshotPage(params)
  return result.image
}

// NOTE: Image validation utilities have been moved to image-helper.js
// Import them from there instead:
// import { getImageFormat, assertValidImage, validateImageMagic } from './image-helper.js'
