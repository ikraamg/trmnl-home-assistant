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
 * @module html/js/preview-generator
 */

import { FetchPreview } from './api-client.js'
import type { Schedule } from '../../types/domain.js'

/**
 * Preview generator coordinating screenshot display and auto-refresh.
 */
export class PreviewGenerator {
  #fetchPreviewCmd: FetchPreview
  #autoRefresh: boolean = false
  #currentBlobUrl: string | null = null

  constructor() {
    this.#fetchPreviewCmd = new FetchPreview()
    this.#autoRefresh = localStorage.getItem('trmnlAutoRefresh') === 'true'
  }

  get autoRefresh(): boolean {
    return this.#autoRefresh
  }

  /**
   * Toggles auto-refresh and persists to localStorage.
   */
  toggleAutoRefresh(enabled: boolean): boolean {
    this.#autoRefresh = enabled
    localStorage.setItem('trmnlAutoRefresh', String(enabled))
    return enabled
  }

  /**
   * Builds URLSearchParams from schedule configuration.
   */
  #buildUrlParams(schedule: Schedule): URLSearchParams {
    const params = new URLSearchParams()

    params.append('viewport', `${schedule.viewport.width}x${schedule.viewport.height}`)

    if (schedule.format && schedule.format !== 'png') {
      params.append('format', schedule.format)
    }

    if (schedule.rotate) {
      params.append('rotate', String(schedule.rotate))
    }

    if (schedule.zoom && schedule.zoom !== 1) {
      params.append('zoom', String(schedule.zoom))
    }

    if (schedule.crop && schedule.crop.enabled) {
      params.append('crop_x', String(schedule.crop.x))
      params.append('crop_y', String(schedule.crop.y))
      params.append('crop_width', String(schedule.crop.width))
      params.append('crop_height', String(schedule.crop.height))
    }

    if (schedule.wait) {
      params.append('wait', String(schedule.wait))
    }

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

    if (schedule.dithering?.enabled) {
      params.append('dithering', '')
      params.append('dither_method', schedule.dithering.method || 'floyd-steinberg')

      params.append('palette', schedule.dithering.palette || 'gray-4')

      if (!schedule.dithering.gammaCorrection) {
        params.append('no_gamma', '')
      }
      if (schedule.dithering.blackLevel > 0) {
        params.append('black_level', String(schedule.dithering.blackLevel))
      }
      if (schedule.dithering.whiteLevel < 100) {
        params.append('white_level', String(schedule.dithering.whiteLevel))
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
   * Coordinates loading state across DOM elements.
   */
  #updateLoadingState(loading: boolean): void {
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
   */
  #showError(message: string): void {
    const error = document.getElementById('errorMessage')
    const errorText = document.getElementById('errorText')
    const placeholder = document.getElementById('previewPlaceholder')

    if (errorText) errorText.textContent = message
    error?.classList.remove('hidden')
    placeholder?.classList.remove('hidden')
  }

  /**
   * Displays loaded image with metadata.
   */
  #displayImage(imageUrl: string, loadTimeMs: number): void {
    const image = document.getElementById('previewImage') as HTMLImageElement | null
    const loadTime = document.getElementById('loadTime')
    const dimensions = document.getElementById('previewDimensions')

    if (!image) return

    if (this.#currentBlobUrl) {
      URL.revokeObjectURL(this.#currentBlobUrl)
    }

    if (loadTime) {
      loadTime.textContent = `${Math.round(loadTimeMs)}ms`
    }

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

    this.#currentBlobUrl = imageUrl
  }

  /**
   * Generates and displays preview image for schedule configuration.
   */
  async call(schedule: Schedule | null): Promise<void> {
    if (!schedule) {
      console.error('No schedule provided to preview generator')
      return
    }

    this.#updateLoadingState(true)

    const startTime = performance.now()

    try {
      const params = this.#buildUrlParams(schedule)

      const blob = await this.#fetchPreviewCmd.call(schedule.dashboard_path, params)
      const imageUrl = URL.createObjectURL(blob)

      const endTime = performance.now()
      const loadTimeMs = endTime - startTime

      this.#displayImage(imageUrl, loadTimeMs)
      this.#updateLoadingState(false)
    } catch (err) {
      console.error('Error loading preview:', err)
      this.#showError((err as Error).message)
      this.#updateLoadingState(false)
    }
  }
}
