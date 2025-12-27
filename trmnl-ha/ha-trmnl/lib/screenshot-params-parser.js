/**
 * Screenshot Parameters Parser Module
 *
 * Converts URL query parameters into structured screenshot request parameters.
 * Handles validation, type coercion, and fallback defaults for all screenshot options.
 *
 * Parameter Categories:
 * 1. Required: viewport (WIDTHxHEIGHT format)
 * 2. Processing: wait, zoom, crop, invert, format, rotate
 * 3. Home Assistant: lang, theme, dark
 * 4. Dithering: method, palette, gammaCorrection, levels, normalize, saturation
 * 5. Optimization: next (for preloading)
 *
 * Validation Strategy:
 * - Required params (viewport): Return null if invalid (request fails)
 * - Optional params: Validate and fall back to safe defaults if invalid
 * - Boolean flags: Presence = true, absence = false (no value needed)
 * - Numeric bounds: Clamp to valid ranges (e.g., blackLevel 0-100)
 *
 * Dithering Special Case:
 * Dithering params are ONLY parsed if "dithering" query param is present.
 * This allows excluding dithering object entirely when not needed.
 *
 * Example URLs:
 * - Basic: ?viewport=800x600
 * - With options: ?viewport=800x600&zoom=0.8&wait=1000&format=jpeg
 * - With dithering: ?viewport=800x600&dithering&palette=gray-4&dither_method=floyd-steinberg
 *
 * NOTE: Called by main.js for each screenshot request to parse URL params.
 *
 * @module lib/screenshot-params-parser
 */

import { VALID_FORMATS, VALID_ROTATIONS } from '../const.js'

/**
 * Parses and validates URL query parameters into screenshot request parameters.
 *
 * Returns null if required parameters are invalid (viewport), otherwise returns
 * object with validated parameters and safe defaults.
 *
 * @class
 */
export class ScreenshotParamsParser {
  /**
   * Parses URL into structured screenshot parameters.
   *
   * Returns null if viewport is missing/invalid (required parameter).
   * Otherwise returns object with:
   * - pagePath: URL pathname (dashboard path)
   * - viewport: {width, height}
   * - Processing params: zoom, wait, crop, format, rotate, invert, lang, theme, dark, next
   * - Dithering params: {enabled, method, palette, ...} (only if dithering flag present)
   *
   * @param {URL} requestUrl - Parsed URL object with searchParams
   * @returns {Object|null} Screenshot parameters or null if invalid
   */
  call(requestUrl) {
    const viewport = this.#parseViewport(requestUrl)
    if (!viewport) return null

    return {
      pagePath: requestUrl.pathname,
      viewport,
      ...this.#parseProcessing(requestUrl),
      ...this.#parseDithering(requestUrl),
    }
  }

  /**
   * Parses viewport dimensions from "viewport=WIDTHxHEIGHT" parameter.
   *
   * Required Format: "WIDTHxHEIGHT" (e.g., "800x600")
   * - Must have exactly 2 parts separated by 'x'
   * - Both parts must be valid integers
   *
   * Returns null if invalid (causes request to fail with 400 Bad Request).
   *
   * @private
   * @param {URL} url - URL object
   * @returns {{width: number, height: number}|null} Viewport dimensions or null
   */
  #parseViewport(url) {
    const viewportParams = (url.searchParams.get('viewport') || '')
      .split('x')
      .map((n) => parseInt(n))

    if (viewportParams.length != 2 || !viewportParams.every((x) => !isNaN(x))) {
      return null
    }

    return {
      width: viewportParams[0],
      height: viewportParams[1],
    }
  }

  /**
   * Parses image processing and Home Assistant configuration parameters.
   *
   * Parameters Parsed:
   * - wait: Extra wait time in ms (undefined if not provided or invalid)
   * - zoom: Browser zoom level (default 1.0, must be > 0)
   * - crop: {x, y, width, height} (null if any param missing/invalid/non-positive)
   * - invert: Boolean flag (presence = true)
   * - format: 'png'|'jpeg'|'bmp' (validated against VALID_FORMATS, default 'png')
   * - rotate: 90|180|270 (validated against VALID_ROTATIONS, undefined if invalid)
   * - lang: Language code string (undefined if not provided)
   * - theme: Theme name string (undefined if not provided)
   * - dark: Boolean flag (presence = true)
   * - next: Seconds until next request for preloading (undefined if < 0 or invalid)
   *
   * Crop Validation:
   * Requires ALL four crop params (crop_x, crop_y, crop_width, crop_height).
   * Width and height must be positive. Missing any param → crop = null.
   *
   * Zoom Validation:
   * Must be > 0. Invalid or non-positive → falls back to 1.0.
   *
   * @private
   * @param {URL} url - URL object
   * @returns {Object} Processing parameters object
   */
  #parseProcessing(url) {
    // Wait time
    let extraWait = parseInt(url.searchParams.get('wait'))
    if (isNaN(extraWait)) extraWait = undefined

    // Zoom
    let zoom = parseFloat(url.searchParams.get('zoom'))
    if (isNaN(zoom) || zoom <= 0) zoom = 1

    // Crop parameters
    let crop = null
    const cropX = parseInt(url.searchParams.get('crop_x'))
    const cropY = parseInt(url.searchParams.get('crop_y'))
    const cropWidth = parseInt(url.searchParams.get('crop_width'))
    const cropHeight = parseInt(url.searchParams.get('crop_height'))

    if (
      !isNaN(cropX) &&
      !isNaN(cropY) &&
      !isNaN(cropWidth) &&
      !isNaN(cropHeight) &&
      cropWidth > 0 &&
      cropHeight > 0
    ) {
      crop = { x: cropX, y: cropY, width: cropWidth, height: cropHeight }
    }

    // Invert
    const invert = url.searchParams.has('invert')

    // Format
    let format = url.searchParams.get('format') || 'png'
    if (!VALID_FORMATS.includes(format)) format = 'png'

    // Rotation
    let rotate = parseInt(url.searchParams.get('rotate'))
    if (isNaN(rotate) || !VALID_ROTATIONS.includes(rotate)) rotate = undefined

    // Language, theme, dark mode
    const lang = url.searchParams.get('lang') || undefined
    const theme = url.searchParams.get('theme') || undefined
    const dark = url.searchParams.has('dark')

    // Next parameter for preloading
    let next = parseInt(url.searchParams.get('next'))
    if (isNaN(next) || next < 0) next = undefined

    return {
      extraWait,
      zoom,
      crop,
      invert,
      format,
      rotate,
      lang,
      theme,
      dark,
      next,
    }
  }

  /**
   * Parses dithering parameters when dithering is enabled.
   *
   * Master Flag:
   * Returns {dithering: undefined} if "dithering" query param is absent.
   * This allows excluding entire dithering config when not needed.
   *
   * Parameters Parsed (only if dithering enabled):
   * - method: Algorithm to use (default 'floyd-steinberg')
   * - palette: Color/grayscale palette (default 'gray-4')
   * - gammaCorrection: Boolean (default true, inverted via 'no_gamma' flag)
   * - blackLevel: 0-100 (default 0, clamped to valid range)
   * - whiteLevel: 0-100 (default 100, clamped to valid range)
   * - normalize: Boolean flag (presence = true)
   * - saturationBoost: Boolean flag (presence = true)
   *
   * Gamma Correction Logic (Inverted):
   * Defaults to true (recommended for e-ink). To disable, add "no_gamma" to URL.
   * Example: ?dithering&no_gamma (disables gamma correction)
   *
   * Level Validation:
   * blackLevel and whiteLevel are clamped to 0-100 range. Invalid values
   * (NaN, negative, >100) fall back to defaults (0 for black, 100 for white).
   *
   * NOTE: Dithering is expensive - only parse when explicitly requested via flag.
   *
   * @private
   * @param {URL} url - URL object
   * @returns {Object} Dithering config object or {dithering: undefined}
   */
  #parseDithering(url) {
    const ditheringEnabled = url.searchParams.has('dithering')

    if (!ditheringEnabled) {
      return { dithering: undefined }
    }

    const ditherMethod =
      url.searchParams.get('dither_method') || 'floyd-steinberg'
    const palette = url.searchParams.get('palette') || 'gray-4'

    const gammaCorrection = !url.searchParams.has('no_gamma')

    let blackLevel = parseInt(url.searchParams.get('black_level'))
    if (isNaN(blackLevel) || blackLevel < 0 || blackLevel > 100) blackLevel = 0

    let whiteLevel = parseInt(url.searchParams.get('white_level'))
    if (isNaN(whiteLevel) || whiteLevel < 0 || whiteLevel > 100)
      whiteLevel = 100

    const normalize = url.searchParams.has('normalize')
    const saturationBoost = url.searchParams.has('saturation_boost')

    return {
      dithering: {
        enabled: true,
        method: ditherMethod,
        palette,
        gammaCorrection,
        blackLevel,
        whiteLevel,
        normalize,
        saturationBoost,
      },
    }
  }
}
