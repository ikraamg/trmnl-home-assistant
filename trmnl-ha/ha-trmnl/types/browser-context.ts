/**
 * Browser Context Types for Home Assistant DOM Elements
 *
 * These types describe Home Assistant's custom elements and shadow DOM structure
 * for use in Puppeteer page.evaluate() calls.
 *
 * Home Assistant uses Web Components with Shadow DOM:
 * <home-assistant>
 *   #shadow-root
 *     <home-assistant-main>
 *       #shadow-root
 *         <partial-panel-resolver>
 *           <ha-panel-*>
 *
 * @module types/browser-context
 */

// =============================================================================
// HOME ASSISTANT ELEMENTS
// =============================================================================

/**
 * Home Assistant root custom element
 *
 * The main entry point for HA's web components. Contains shadow DOM with
 * all HA UI components.
 */
export interface HomeAssistantElement extends HTMLElement {
  shadowRoot: ShadowRoot

  /**
   * Changes the UI language
   * @param lang - Language code (e.g., "en", "fr")
   * @param reload - Whether to reload the page after changing
   */
  _selectLanguage(lang: string, reload: boolean): void

  /**
   * Dispatches custom events for theme changes
   */
  dispatchEvent(event: CustomEvent<SetThemeDetail>): boolean
}

/** Detail payload for settheme custom event */
export interface SetThemeDetail {
  theme: string
  dark: boolean
}

/**
 * Home Assistant main container element
 *
 * Child of home-assistant, contains the panel resolver
 */
export interface HomeAssistantMainElement extends HTMLElement {
  shadowRoot: ShadowRoot
}

/**
 * Panel resolver element that loads dashboard panels
 *
 * Has _loading flag while loading panels
 */
export interface PartialPanelResolverElement extends HTMLElement {
  /** True while panel is loading */
  _loading?: boolean

  /** Child panels */
  children: HTMLCollectionOf<PanelElement>
}

/**
 * Dashboard panel element (e.g., ha-panel-lovelace)
 *
 * May have _loading flag while content loads
 */
export interface PanelElement extends HTMLElement {
  /** True while panel content is loading */
  _loading?: boolean
}

/**
 * Notification manager element for toasts
 */
export interface NotificationManagerElement extends HTMLElement {
  shadowRoot: ShadowRoot
}

// =============================================================================
// PAGE STABILITY METRICS
// =============================================================================

/** Metrics for detecting page content stability */
export interface PageStabilityMetrics {
  /** Document scroll height */
  height: number

  /** Content hash (innerHTML length as proxy) */
  contentHash: number
}

// =============================================================================
// WINDOW AUGMENTATION
// =============================================================================

/**
 * Augment Window for frontend app instance
 *
 * Used in html/js/app.ts for the global app instance
 */
declare global {
  interface Window {
    /** Frontend application instance */
    app?: AppInstance
  }
}

/**
 * Frontend application instance interface
 *
 * Exposed on window.app for HTML onclick handlers
 */
export interface AppInstance {
  init(): Promise<void>
  createSchedule(): Promise<void>
  selectSchedule(id: string): void
  deleteSchedule(id: string): Promise<void>
  updateField(field: string, value: unknown): Promise<void>
  loadPreview(): Promise<void>
  saveSchedule(): Promise<void>
  toggleEnabled(): Promise<void>
  openCropModal(): void
  closeCropModal(): void
  saveCrop(): void
  cancelCrop(): void
}
