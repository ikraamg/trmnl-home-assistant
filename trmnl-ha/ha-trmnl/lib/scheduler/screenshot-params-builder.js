/**
 * Screenshot Parameters Builder - Factory Pattern
 * Converts schedule config to screenshot request params
 *
 * Following Factory Pattern:
 * - Creates complex objects with defaults
 * - Single source of truth for param building
 * - Reusable by Scheduler AND RequestHandler
 *
 * NOTE: RequestHandler in main.js can also use this
 * by converting URL query params to a schedule-like object first
 */

/**
 * Screenshot Parameters Builder
 * Builds standardized screenshot request params from schedule config
 */
export class ScreenshotParamsBuilder {
  // Default values (centralized)
  #defaults = {
    pagePath: '/lovelace/0',
    viewport: { width: 758, height: 1024 },
    extraWait: undefined,
    invert: false,
    zoom: 1,
    format: 'png',
    dark: false,
  }

  /**
   * Build params from schedule object
   * @param {Object} schedule - Schedule configuration
   * @returns {Object} - Screenshot request params
   */
  call(schedule) {
    return {
      pagePath: schedule.dashboard_path || this.#defaults.pagePath,
      viewport: schedule.viewport || this.#defaults.viewport,
      extraWait: schedule.wait ?? this.#defaults.extraWait,
      invert: schedule.invert || this.#defaults.invert,
      zoom: schedule.zoom || this.#defaults.zoom,
      crop: schedule.crop?.enabled ? schedule.crop : undefined,
      format: schedule.format || this.#defaults.format,
      rotate: schedule.rotate,
      lang: schedule.lang,
      theme: schedule.theme,
      dark: schedule.dark || this.#defaults.dark,
      dithering: schedule.dithering?.enabled ? schedule.dithering : undefined,
    }
  }

  /**
   * Get default values
   * Useful for RequestHandler to know what defaults to apply
   * @returns {Object} - Default param values
   */
  getDefaults() {
    return { ...this.#defaults }
  }
}
