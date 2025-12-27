/* global document, Image */
/**
 * Preview Generator Module
 *
 * Generates screenshot previews from schedule configurations.
 * Translates complex schedule settings into URL parameters for backend.
 *
 * Design Pattern:
 * Command Pattern - uses FetchPreview command for API communication.
 * Pure functions (#buildUrlParams) separate data transformation from side effects.
 * Loading State Machine - coordinates multiple DOM elements during async operations.
 *
 * URL Parameter Complexity:
 * Translates 15+ schedule fields into query string parameters.
 * Each parameter has specific serialization rules (viewport: "WxH", flags: empty string).
 * Conditional parameters (only include if non-default) to minimize URL length.
 *
 * Parameter Categories:
 * - Viewport: width×height (always required)
 * - Format: png/jpeg/webp (default: png, omitted if default)
 * - Transformations: rotate, zoom, crop (geometric operations)
 * - Appearance: theme, dark mode, language, invert
 * - Dithering: method, palette, gamma, levels, normalize, saturation
 * - Timing: wait delay for page load
 *
 * Loading State Coordination:
 * Manages 6 DOM elements during preview lifecycle:
 * 1. Placeholder (shown when no image)
 * 2. Loading indicator (shown during fetch)
 * 3. Preview image (<img> element)
 * 4. Error message (shown on failure)
 * 5. Load time display (performance metric)
 * 6. Dimensions display (image metadata)
 *
 * State Transitions:
 * Initial → Loading → Success (show image + metadata)
 *                   → Error (show error + placeholder)
 *
 * Auto-Refresh Persistence:
 * Stores auto-refresh preference in localStorage (survives page reload).
 * Loaded at construction, updated via toggleAutoRefresh().
 * Consumer (app.js) polls this preference to decide refresh timing.
 *
 * Performance Measurement:
 * Uses performance.now() for high-precision timing (sub-millisecond accuracy).
 * Measures full preview generation time (network + processing + rendering).
 *
 * Image Dimension Detection:
 * Uses temporary Image() object to read naturalWidth/naturalHeight.
 * Asynchronous (onload callback) because image must decode first.
 * Displays actual rendered dimensions (post-dithering/processing).
 *
 * Memory Management:
 * Creates blob URLs (URL.createObjectURL) for image display.
 * Automatically revokes previous blob URL before creating new one.
 * Prevents memory leaks during auto-refresh sessions.
 *
 * @module html/js/preview-generator
 */

import { FetchPreview } from './api-client.js'

/**
 * Preview generator coordinating screenshot display and auto-refresh.
 *
 * Responsibilities:
 * - Translate schedule config to URL parameters
 * - Fetch preview images via API command
 * - Coordinate loading state across multiple DOM elements
 * - Persist auto-refresh preference
 * - Measure and display performance metrics
 *
 * Stateful Elements:
 * - #autoRefresh: Persisted user preference (localStorage)
 * - #fetchPreviewCmd: Injected command instance
 *
 * @class
 */
export class PreviewGenerator {
  // Command instance (dependency injection)
  #fetchPreviewCmd

  // Auto-refresh state (persisted to localStorage)
  #autoRefresh = false

  // Current blob URL (tracked for cleanup)
  #currentBlobUrl = null

  /**
   * Creates generator and loads auto-refresh preference.
   * Initializes FetchPreview command and restores user preference from localStorage.
   */
  constructor() {
    this.#fetchPreviewCmd = new FetchPreview()

    // Restore auto-refresh preference (survives page reload)
    this.#autoRefresh = localStorage.getItem('trmnlAutoRefresh') === 'true'
  }

  /**
   * Read-only access to auto-refresh state.
   * @returns {boolean} True if auto-refresh enabled
   */
  get autoRefresh() {
    return this.#autoRefresh
  }

  /**
   * Toggles auto-refresh and persists to localStorage.
   *
   * Persistence:
   * Stores boolean as string ('true'/'false') in localStorage.
   * Survives page reload and browser restart.
   *
   * @param {boolean} enabled - New auto-refresh state
   * @returns {boolean} New state (confirmation)
   */
  toggleAutoRefresh(enabled) {
    this.#autoRefresh = enabled
    localStorage.setItem('trmnlAutoRefresh', enabled)
    return enabled
  }

  /**
   * Builds URLSearchParams from schedule configuration.
   *
   * Pure Function:
   * No side effects - only transforms input data to URL parameters.
   * Testable in isolation without DOM or network dependencies.
   *
   * Serialization Rules:
   * - Viewport: "WIDTHxHEIGHT" format (e.g., "768x1024")
   * - Boolean flags: Empty string value (e.g., "dark=", "invert=")
   * - Optional params: Only included if non-default (reduces URL length)
   * - Nested objects: Flattened (e.g., crop.width → crop_width)
   *
   * Default Omissions:
   * - format: Only included if not 'png' (png is default)
   * - zoom: Only included if not 1 (no zoom)
   * - gammaCorrection: Inverted logic (no_gamma flag only if disabled)
   * - blackLevel: Only if >0, whiteLevel: Only if <100
   *
   * Dithering Parameters:
   * Conditional block - only added if dithering.enabled = true.
   * Uses empty flag pattern: "dithering=" signals enabled.
   * Palette parameter always included (gray-4 default if missing).
   *
   * Crop Parameters:
   * Only included if crop.enabled = true (4 parameters: x, y, width, height).
   * Prevents sending 0,0,0,0 values when crop disabled.
   *
   * NOTE: Parameter order doesn't matter (URLSearchParams handles encoding).
   * AI: When adding parameters, follow conditional inclusion pattern.
   *
   * @param {Object} schedule - Schedule configuration object
   * @returns {URLSearchParams} Encoded URL parameters ready for fetch
   */
  #buildUrlParams(schedule) {
    const params = new URLSearchParams()

    // Viewport (always required)
    params.append(
      'viewport',
      `${schedule.viewport.width}x${schedule.viewport.height}`
    )

    // Format
    if (schedule.format && schedule.format !== 'png') {
      params.append('format', schedule.format)
    }

    // Rotation
    if (schedule.rotate) {
      params.append('rotate', schedule.rotate)
    }

    // Zoom settings
    if (schedule.zoom && schedule.zoom !== 1) {
      params.append('zoom', schedule.zoom)
    }

    // Crop settings
    if (schedule.crop && schedule.crop.enabled) {
      params.append('crop_x', schedule.crop.x)
      params.append('crop_y', schedule.crop.y)
      params.append('crop_width', schedule.crop.width)
      params.append('crop_height', schedule.crop.height)
    }

    // Wait time
    if (schedule.wait) {
      params.append('wait', schedule.wait)
    }

    // Theme and appearance
    if (schedule.theme) {
      params.append('theme', schedule.theme)
    }
    if (schedule.dark) {
      params.append('dark', '')
    }
    if (schedule.lang) {
      params.append('lang', schedule.lang)
    }
    if (schedule.invert) {
      params.append('invert', '')
    }

    // Dithering settings
    if (schedule.dithering?.enabled) {
      params.append('dithering', '')
      params.append(
        'dither_method',
        schedule.dithering.method || 'floyd-steinberg'
      )

      // Use palette (always set)
      params.append('palette', schedule.dithering.palette || 'gray-4')

      if (!schedule.dithering.gammaCorrection) {
        params.append('no_gamma', '')
      }
      if (schedule.dithering.blackLevel > 0) {
        params.append('black_level', schedule.dithering.blackLevel)
      }
      if (schedule.dithering.whiteLevel < 100) {
        params.append('white_level', schedule.dithering.whiteLevel)
      }
      if (schedule.dithering.normalize) {
        params.append('normalize', '')
      }
      if (schedule.dithering.saturationBoost) {
        params.append('saturation_boost', '')
      }
    }

    return params
  }

  /**
   * Coordinates loading state across 6 DOM elements.
   *
   * State Machine Pattern:
   * Loading=true → Hide everything, show spinner
   * Loading=false → Hide spinner (caller shows success/error)
   *
   * DOM Elements Managed:
   * - previewPlaceholder: Empty state graphic
   * - loadingIndicator: Spinner animation
   * - previewImage: <img> element for screenshot
   * - errorMessage: Error banner
   * - loadTime: Performance metric display
   * - previewDimensions: Image size metadata
   *
   * Defensive DOM Access:
   * Uses optional chaining (?.) to prevent crashes if elements missing.
   * Graceful degradation if DOM structure changes.
   *
   * Two-Phase Coordination:
   * Phase 1 (loading=true): Clear previous state, show spinner
   * Phase 2 (loading=false): Hide spinner, caller shows result
   *
   * @param {boolean} loading - True to show loading state, false to clear it
   */
  #updateLoadingState(loading) {
    const placeholder = document.getElementById('previewPlaceholder')
    const loadingEl = document.getElementById('loadingIndicator')
    const image = document.getElementById('previewImage')
    const error = document.getElementById('errorMessage')
    const loadTime = document.getElementById('loadTime')
    const dimensions = document.getElementById('previewDimensions')

    if (loading) {
      placeholder?.classList.add('hidden')
      image?.classList.add('hidden')
      dimensions?.classList.add('hidden')
      error?.classList.add('hidden')
      loadingEl?.classList.remove('hidden')
      if (loadTime) loadTime.textContent = ''
    } else {
      loadingEl?.classList.add('hidden')
    }
  }

  /**
   * Displays error message to user.
   *
   * Error UI Components:
   * - errorText: Text content (error.message from fetch)
   * - errorMessage: Error banner container
   * - previewPlaceholder: Shown alongside error (visual fallback)
   *
   * Error Messages:
   * Typically HTTP errors like "HTTP 500: Internal Server Error".
   * Comes from FetchPreview command (thrown Error objects).
   *
   * @param {string} message - Error message to display
   */
  #showError(message) {
    const error = document.getElementById('errorMessage')
    const errorText = document.getElementById('errorText')
    const placeholder = document.getElementById('previewPlaceholder')

    if (errorText) errorText.textContent = message
    error?.classList.remove('hidden')
    placeholder?.classList.remove('hidden')
  }

  /**
   * Displays loaded image with metadata.
   *
   * Image Loading Process:
   * 1. Revoke previous blob URL (memory cleanup)
   * 2. Set load time metric (from performance.now() measurement)
   * 3. Create temporary Image() to read dimensions asynchronously
   * 4. Display actual image in preview <img> element
   * 5. Store new blob URL for future cleanup
   *
   * Dimension Detection:
   * Uses Image.onload callback because dimensions not available until decoded.
   * Reads naturalWidth/naturalHeight (actual image size, not CSS size).
   * Displays post-processing dimensions (after dithering/crop/etc).
   *
   * Blob URL Pattern:
   * imageUrl is blob:// URL created from fetch response.
   * Browser automatically handles image decoding and rendering.
   *
   * Memory Management:
   * Revokes previous blob URL before setting new one.
   * Critical for auto-refresh sessions that generate many previews.
   * Prevents browser memory accumulation of orphaned blob URLs.
   *
   * Performance Metric:
   * Rounds milliseconds to nearest integer for display (sub-ms precision not useful).
   *
   * @param {string} imageUrl - Blob URL for preview image
   * @param {number} loadTimeMs - Total load time in milliseconds
   */
  #displayImage(imageUrl, loadTimeMs) {
    const image = document.getElementById('previewImage')
    const loadTime = document.getElementById('loadTime')
    const dimensions = document.getElementById('previewDimensions')

    if (!image) return

    // Revoke previous blob URL to prevent memory leak
    if (this.#currentBlobUrl) {
      URL.revokeObjectURL(this.#currentBlobUrl)
    }

    // Set load time
    if (loadTime) {
      loadTime.textContent = `${Math.round(loadTimeMs)}ms`
    }

    // Load image to get actual dimensions
    const img = new Image()
    img.onload = () => {
      if (dimensions) {
        dimensions.textContent = `${img.naturalWidth} x ${img.naturalHeight} pixels`
        dimensions.classList.remove('hidden')
      }
    }
    img.src = imageUrl

    image.src = imageUrl
    image.classList.remove('hidden')

    // Store new blob URL for future cleanup
    this.#currentBlobUrl = imageUrl
  }

  /**
   * Generates and displays preview image for schedule configuration.
   *
   * Orchestration Flow:
   * 1. Validate schedule input (early return if null)
   * 2. Show loading state (hide previous content, show spinner)
   * 3. Build URL parameters from schedule config
   * 4. Fetch preview image blob from backend
   * 5. Create blob URL for display
   * 6. Measure total load time (performance.now())
   * 7. Display image with metadata OR show error
   * 8. Clear loading state
   *
   * Performance Timing:
   * Measures from parameter building to blob URL creation.
   * Includes network latency + backend processing + dithering.
   * Does NOT include final image decoding/rendering (async).
   *
   * Error Handling:
   * Try/catch wraps entire async operation chain.
   * Errors logged to console (debugging) and displayed to user (UX).
   * Loading state cleared on both success and error (prevents stuck spinner).
   *
   * Validation:
   * Null schedule check prevents crashing on edge cases.
   * Logs error and returns early (no throw).
   *
   * State Consistency:
   * Always calls #updateLoadingState(false) in finally block would be better.
   * Current implementation calls it in both try and catch (slight duplication).
   *
   * Memory Management:
   * Blob URLs automatically cleaned up by #displayImage method.
   * Previous blob URL revoked before creating new one.
   * Safe for long-running auto-refresh sessions.
   *
   * @param {Object} schedule - Schedule configuration object
   * @returns {Promise<void>} Resolves when preview displayed or error shown
   */
  async call(schedule) {
    if (!schedule) {
      console.error('No schedule provided to preview generator')
      return
    }

    this.#updateLoadingState(true)

    const startTime = performance.now()

    try {
      // Build URL parameters
      const params = this.#buildUrlParams(schedule)

      // Fetch preview image
      const blob = await this.#fetchPreviewCmd.call(
        schedule.dashboard_path,
        params
      )
      const imageUrl = URL.createObjectURL(blob)

      const endTime = performance.now()
      const loadTimeMs = endTime - startTime

      // Display image
      this.#displayImage(imageUrl, loadTimeMs)
      this.#updateLoadingState(false)
    } catch (err) {
      console.error('Error loading preview:', err)
      this.#showError(err.message)
      this.#updateLoadingState(false)
    }
  }
}
