/**
 * Home Assistant DOM Element Helpers
 *
 * Type-safe query utilities for Home Assistant custom elements.
 * These are inline type definitions used inside page.evaluate() calls.
 *
 * Since page.evaluate() runs in browser context (not Node.js), we can't
 * import modules there. Instead, this module provides:
 * 1. Type definitions for HA custom elements
 * 2. Inline type assertion patterns for common operations
 *
 * @module lib/browser/ha-elements
 */

// =============================================================================
// INLINE TYPE DEFINITIONS FOR page.evaluate()
// =============================================================================

/**
 * Type for home-assistant element with shadowRoot and custom methods.
 * Use inside page.evaluate() for type safety.
 *
 * @example
 * await page.evaluate(() => {
 *   const haEl = document.querySelector('home-assistant') as HAElement | null
 *   if (haEl?.shadowRoot) {
 *     // TypeScript knows shadowRoot exists
 *   }
 * })
 */
export type HAElement = Element & {
  shadowRoot: ShadowRoot | null
  _selectLanguage?: (lang: string, reload: boolean) => void
}

/**
 * Type for home-assistant-main element
 */
export type HAMainElement = Element & {
  shadowRoot: ShadowRoot | null
}

/**
 * Type for partial-panel-resolver element with loading state
 */
export type PanelResolverElement = Element & {
  _loading?: boolean
  children: HTMLCollection
}

/**
 * Type for panel elements with loading state
 */
export type PanelElement = Element & {
  _loading?: boolean
}

/**
 * Type for notification-manager element
 */
export type NotificationManagerElement = Element & {
  shadowRoot: ShadowRoot | null
}

// =============================================================================
// INLINE QUERY HELPERS (for use inside page.evaluate)
// =============================================================================

/**
 * Inline function to check if HA DOM is fully loaded.
 * Copy this into page.evaluate() calls.
 *
 * @example
 * await page.waitForFunction(() => {
 *   // Copy isHAReady implementation here
 * })
 */
export const isHAReadyCheck = `
  const haEl = document.querySelector('home-assistant')
  if (!haEl || !haEl.shadowRoot) return false

  const mainEl = haEl.shadowRoot.querySelector('home-assistant-main')
  if (!mainEl || !mainEl.shadowRoot) return false

  const resolver = mainEl.shadowRoot.querySelector('partial-panel-resolver')
  if (!resolver || resolver._loading) return false

  const panel = resolver.children[0]
  return !panel?._loading
`

// =============================================================================
// TYPED EVALUATE HELPERS
// =============================================================================

import type { Page } from 'puppeteer'

/**
 * Waits for Home Assistant DOM structure to be fully loaded.
 * Checks shadow DOM tree from home-assistant → home-assistant-main → partial-panel-resolver.
 */
export async function waitForHAReady(page: Page, timeout: number = 30000): Promise<boolean> {
  try {
    await page.waitForFunction(
      () => {
        const haEl = document.querySelector('home-assistant') as HAElement | null
        if (!haEl?.shadowRoot) return false

        const mainEl = haEl.shadowRoot.querySelector('home-assistant-main') as HAMainElement | null
        if (!mainEl?.shadowRoot) return false

        const resolver = mainEl.shadowRoot.querySelector(
          'partial-panel-resolver'
        ) as PanelResolverElement | null
        if (!resolver || resolver._loading) return false

        const panel = resolver.children[0] as PanelElement | undefined
        return !panel?._loading
      },
      { timeout }
    )
    return true
  } catch {
    return false
  }
}

/**
 * Gets content hash for stability detection.
 * Uses innerHTML length as a proxy for content changes.
 */
export async function getHAContentHash(page: Page): Promise<number> {
  return page.evaluate(() => {
    const haEl = document.querySelector('home-assistant') as HAElement | null
    return haEl?.shadowRoot?.innerHTML?.length ?? 0
  })
}

/**
 * Changes Home Assistant UI language.
 */
export async function changeHALanguage(page: Page, lang: string): Promise<void> {
  await page.evaluate((newLang: string) => {
    const haEl = document.querySelector('home-assistant') as HAElement | null
    haEl?._selectLanguage?.(newLang, false)
  }, lang)
}

/**
 * Sets Home Assistant theme and dark mode.
 */
export async function setHATheme(page: Page, theme: string, dark: boolean): Promise<void> {
  await page.evaluate(
    (t: string, d: boolean) => {
      const haEl = document.querySelector('home-assistant')
      haEl?.dispatchEvent(
        new CustomEvent('settheme', {
          detail: { theme: t, dark: d },
        })
      )
    },
    theme,
    dark
  )
}

/**
 * Dismisses action toast from notification manager if present.
 * Returns true if a toast was dismissed.
 */
export async function dismissToast(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const haEl = document.querySelector('home-assistant') as HAElement | null
    if (!haEl?.shadowRoot) return false

    const notifyEl = haEl.shadowRoot.querySelector(
      'notification-manager'
    ) as NotificationManagerElement | null
    if (!notifyEl?.shadowRoot) return false

    const actionEl = notifyEl.shadowRoot.querySelector(
      'ha-toast *[slot=action]'
    ) as HTMLElement | null
    if (!actionEl) return false

    actionEl.click()
    return true
  })
}
