/**
 * TRMNL HA Schedule Manager - Main Application Module
 *
 * Front-end orchestrator coordinating all UI modules and user interactions.
 * Exposes global app instance (window.app) for HTML onclick handlers.
 *
 * Architecture Pattern:
 * Façade pattern - presents simple API to HTML while coordinating complex subsystems.
 *
 * NOTE: This is the only module that touches window global.
 * NOTE: When adding features, follow delegation pattern (create module, call from App).
 *
 * @module html/js/app
 */

import { ScheduleManager } from './schedule-manager.js'
import {
  RenderTabs,
  RenderEmptyState,
  RenderScheduleContent,
} from './ui-renderer.js'
import { PreviewGenerator } from './preview-generator.js'
import { CropModal } from './crop-modal.js'
import { ConfirmModal } from './confirm-modal.js'
import { DevicePresetsManager } from './device-presets.js'
import { SendSchedule } from './api-client.js'
import type {
  Schedule,
  CropRegion,
  ScheduleUpdate,
} from '../../types/domain.js'

// =============================================================================
// FORM PARSING HELPERS
// =============================================================================

/**
 * Safely parse integer from form input, returning default only for empty/NaN.
 * Unlike `parseInt(value) || default`, this preserves 0 as a valid value.
 */
function parseIntOrDefault(
  value: string | undefined,
  defaultValue: number
): number {
  if (!value || value.trim() === '') return defaultValue
  const parsed = parseInt(value, 10)
  return isNaN(parsed) ? defaultValue : parsed
}

/**
 * Safely parse float from form input, returning default only for empty/NaN.
 * Unlike `parseFloat(value) || default`, this preserves 0 as a valid value.
 */
function parseFloatOrDefault(
  value: string | undefined,
  defaultValue: number
): number {
  if (!value || value.trim() === '') return defaultValue
  const parsed = parseFloat(value)
  return isNaN(parsed) ? defaultValue : parsed
}

// Extend Window to include app instance
declare global {
  interface Window {
    app: App
  }
}

/** Crop settings from modal */
interface CropSettings extends CropRegion {
  enabled: boolean
}

/**
 * Main application class coordinating all UI modules.
 */
class App {
  #scheduleManager: ScheduleManager
  #previewGenerator: PreviewGenerator
  #cropModal: CropModal
  #confirmModal: ConfirmModal
  #devicePresetsManager: DevicePresetsManager

  constructor() {
    this.#scheduleManager = new ScheduleManager()
    this.#previewGenerator = new PreviewGenerator()
    this.#cropModal = new CropModal()
    this.#confirmModal = new ConfirmModal()
    this.#devicePresetsManager = new DevicePresetsManager()
  }

  // =============================================================================
  // INITIALIZATION
  // =============================================================================

  async init(): Promise<void> {
    try {
      // Show HA status banner if not connected
      this.#updateHAStatusBanner()

      await this.#scheduleManager.loadAll()
      this.renderUI()

      await this.#devicePresetsManager.loadAndRenderPresets()

      const autoRefreshCheckbox = document.getElementById(
        'autoRefreshToggle'
      ) as HTMLInputElement | null
      if (autoRefreshCheckbox) {
        autoRefreshCheckbox.checked = this.#previewGenerator.autoRefresh
      }
    } catch (err) {
      console.error('Error initializing app:', err)
      this.#showError('Failed to load schedules')
    }
  }

  /**
   * Shows/hides the HA status banner based on connection status.
   */
  #updateHAStatusBanner(): void {
    const banner = document.getElementById('haStatusBanner')
    if (!banner) return

    // @ts-expect-error window.uiConfig is injected by server
    const uiConfig = window.uiConfig || { haConnected: false }

    if (uiConfig.haConnected) {
      banner.classList.add('hidden')
    } else {
      banner.classList.remove('hidden')
    }
  }

  // =============================================================================
  // SCHEDULE OPERATIONS
  // =============================================================================

  async createSchedule(): Promise<void> {
    try {
      await this.#scheduleManager.create()
      this.renderUI()
    } catch (err) {
      console.error('Error creating schedule:', err)
      await this.#confirmModal.alert({
        title: 'Error',
        message: 'Failed to create schedule. Please try again.',
        type: 'error',
      })
    }
  }

  selectSchedule(id: string): void {
    this.#scheduleManager.selectSchedule(id)
    this.renderUI()
  }

  async deleteSchedule(id: string): Promise<void> {
    const confirmed = await this.#confirmModal.show({
      title: 'Delete Schedule',
      message:
        'Are you sure you want to delete this schedule? This action cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      confirmClass: 'bg-red-600 hover:bg-red-700',
    })

    if (!confirmed) return

    try {
      await this.#scheduleManager.delete(id)
      this.renderUI()
    } catch (err) {
      console.error('Error deleting schedule:', err)
      await this.#confirmModal.alert({
        title: 'Error',
        message: 'Failed to delete schedule. Please try again.',
        type: 'error',
      })
    }
  }

  async updateField(field: keyof Schedule, value: unknown): Promise<void> {
    const schedule = this.#scheduleManager.activeSchedule
    if (!schedule) return

    const updates = { ...schedule, [field]: value } as ScheduleUpdate
    await this.#scheduleManager.update(schedule.id, updates)

    if (field === 'enabled') {
      this.renderUI()
    }

    if (this.#previewGenerator.autoRefresh) {
      this.loadPreview()
    }
  }

  async sendNow(scheduleId: string, event: Event): Promise<void> {
    const button = event.target as HTMLButtonElement
    const originalText = button.textContent
    const originalBgColor = button.style.backgroundColor

    // Disable button during send
    button.disabled = true
    button.textContent = 'Saving...'
    button.style.opacity = '0.6'
    button.style.cursor = 'not-allowed'

    // Ensure current form values are saved before sending
    // This prevents race conditions between auto-save and send
    await this.updateScheduleFromForm()

    button.textContent = 'Sending...'

    // Use SendSchedule command (follows same pattern as other API calls)
    const sendCommand = new SendSchedule()
    const result = await sendCommand.call(scheduleId)

    if (result.success) {
      button.textContent = '✓ Sent!'
      button.style.backgroundColor = '#10b981'
      button.style.opacity = '1'

      await this.#confirmModal.alert({
        title: '✓ Success!',
        message: 'Screenshot captured and sent to webhook successfully!',
        type: 'success',
      })
    } else {
      console.error('Error sending webhook:', result.error)

      button.textContent = '✗ Failed'
      button.style.backgroundColor = '#ef4444'
      button.style.opacity = '1'

      await this.#confirmModal.alert({
        title: '✗ Error',
        message: `Failed to send webhook: ${result.error ?? 'Unknown error'}`,
        type: 'error',
      })
    }

    // Reset button state if it still exists in DOM
    if (document.body.contains(button)) {
      button.textContent = originalText
      button.style.backgroundColor = originalBgColor
      button.disabled = false
      button.style.opacity = ''
      button.style.cursor = ''
    }
  }

  async updateScheduleFromForm(): Promise<void> {
    const schedule = this.#scheduleManager.activeSchedule
    if (!schedule) return

    const oldName = schedule.name

    const updates = this.#buildScheduleUpdates(schedule)

    await this.#scheduleManager.update(schedule.id, updates)

    if (oldName !== updates.name) {
      this.renderUI()
    } else {
      this.#renderScheduleContent()
    }

    if (this.#previewGenerator.autoRefresh) {
      this.loadPreview()
    }
  }

  #buildScheduleUpdates(schedule: Schedule): ScheduleUpdate {
    // Helper to get input/select element values
    const input = (id: string) =>
      (document.getElementById(id) as HTMLInputElement | null)?.value
    const checkbox = (id: string) =>
      (document.getElementById(id) as HTMLInputElement | null)?.checked ?? false
    const select = (id: string) =>
      (document.getElementById(id) as HTMLSelectElement | null)?.value

    // Check if in HA mode or generic mode from the toggle
    // When toggle is checked = HA mode, unchecked = generic mode
    const haModeCheckbox = document.getElementById(
      's_ha_mode'
    ) as HTMLInputElement | null
    const isHAMode = haModeCheckbox?.checked ?? true // default to HA mode if checkbox missing

    return {
      ...schedule,
      // Mode toggle - always save the current state
      ha_mode: isHAMode,

      // Common fields (always update from form)
      name: input('s_name') || schedule.name,
      cron: input('s_cron') || schedule.cron,
      webhook_url: input('s_webhook') || null,
      viewport: {
        width: parseIntOrDefault(input('s_width'), schedule.viewport.width),
        height: parseIntOrDefault(input('s_height'), schedule.viewport.height),
      },
      crop: {
        enabled: checkbox('s_crop_enabled'),
        x: parseIntOrDefault(input('s_crop_x'), 0),
        y: parseIntOrDefault(input('s_crop_y'), 0),
        width: parseIntOrDefault(
          input('s_crop_width'),
          schedule.viewport.width
        ),
        height: parseIntOrDefault(
          input('s_crop_height'),
          schedule.viewport.height
        ),
      },
      format: (select('s_format') as 'png' | 'jpeg' | 'bmp') || schedule.format,
      rotate: this.#parseRotation(select('s_rotate')),
      zoom: parseFloatOrDefault(input('s_zoom'), 1),
      wait: this.#parseWait(input('s_wait')),
      invert: checkbox('s_invert'),
      dithering: {
        enabled: checkbox('s_dithering'),
        method: select('s_method') || 'floyd-steinberg',
        palette: select('s_palette') || 'gray-4',
        gammaCorrection:
          (document.getElementById('s_gamma') as HTMLInputElement | null)
            ?.checked ?? true,
        blackLevel: parseIntOrDefault(input('s_black'), 0),
        whiteLevel: parseIntOrDefault(input('s_white'), 100),
        normalize: checkbox('s_normalize'),
        saturationBoost: checkbox('s_saturation'),
        compressionLevel: parseIntOrDefault(select('s_compression'), 9) as
          | 1
          | 2
          | 3
          | 4
          | 5
          | 6
          | 7
          | 8
          | 9,
      },

      // Mode-specific fields: only update when in that mode, otherwise preserve existing
      // HA mode fields - only read from form when in HA mode
      dashboard_path: isHAMode
        ? input('s_path') || schedule.dashboard_path
        : schedule.dashboard_path,
      theme: isHAMode ? select('s_theme') || null : schedule.theme,
      dark: isHAMode ? checkbox('s_dark') : schedule.dark,
      lang: isHAMode ? input('s_lang') || null : schedule.lang,

      // Generic mode fields - only read from form when in generic mode
      target_url: isHAMode ? undefined : input('s_target_url') || undefined,
    }
  }

  #parseRotation(value: string | undefined): number | null {
    return value ? parseInt(value) : null
  }

  #parseWait(value: string | undefined): number | null {
    return value ? parseInt(value) : null
  }

  // =============================================================================
  // UI RENDERING
  // =============================================================================

  renderUI(): void {
    const schedules = this.#scheduleManager.schedules
    const activeId = this.#scheduleManager.activeScheduleId

    new RenderTabs(schedules, activeId).call()

    if (this.#scheduleManager.isEmpty()) {
      new RenderEmptyState().call()
    } else {
      this.#renderScheduleContent()
    }
  }

  #renderScheduleContent(): void {
    const schedule = this.#scheduleManager.activeSchedule
    if (schedule) {
      new RenderScheduleContent(schedule).call()

      this.#devicePresetsManager.afterDOMRender(schedule)

      const autoRefreshCheckbox = document.getElementById(
        'autoRefreshToggle'
      ) as HTMLInputElement | null
      if (autoRefreshCheckbox) {
        autoRefreshCheckbox.checked = this.#previewGenerator.autoRefresh
      }
    }
  }

  // =============================================================================
  // PREVIEW OPERATIONS
  // =============================================================================

  toggleAutoRefresh(enabled: boolean): void {
    this.#previewGenerator.toggleAutoRefresh(enabled)

    if (enabled) {
      this.loadPreview()
    }
  }

  async loadPreview(): Promise<void> {
    const schedule = this.#scheduleManager.activeSchedule
    if (!schedule) return

    await this.#previewGenerator.call(schedule)
  }

  // =============================================================================
  // CROP MODAL OPERATIONS
  // =============================================================================

  async openCropModal(): Promise<void> {
    const schedule = this.#scheduleManager.activeSchedule
    if (!schedule) return

    await this.#cropModal.open(schedule, async (cropSettings: CropSettings) => {
      const updates = { ...schedule, crop: cropSettings }
      await this.#scheduleManager.update(schedule.id, updates)

      this.#updateCropFormInputs(cropSettings)

      if (this.#previewGenerator.autoRefresh) {
        this.loadPreview()
      }
    })
  }

  #updateCropFormInputs(crop: CropSettings): void {
    const cropEnabledInput = document.getElementById(
      's_crop_enabled'
    ) as HTMLInputElement | null
    const cropXInput = document.getElementById(
      's_crop_x'
    ) as HTMLInputElement | null
    const cropYInput = document.getElementById(
      's_crop_y'
    ) as HTMLInputElement | null
    const cropWidthInput = document.getElementById(
      's_crop_width'
    ) as HTMLInputElement | null
    const cropHeightInput = document.getElementById(
      's_crop_height'
    ) as HTMLInputElement | null

    if (cropEnabledInput) cropEnabledInput.checked = crop.enabled
    if (cropXInput) cropXInput.value = String(crop.x)
    if (cropYInput) cropYInput.value = String(crop.y)
    if (cropWidthInput) cropWidthInput.value = String(crop.width)
    if (cropHeightInput) cropHeightInput.value = String(crop.height)
  }

  closeCropModal(): void {
    this.#cropModal.close()
  }

  resetCrop(): void {
    const schedule = this.#scheduleManager.activeSchedule
    if (schedule) {
      this.#cropModal.reset(schedule)
    }
  }

  fitToDevice(): void {
    const schedule = this.#scheduleManager.activeSchedule
    if (schedule) {
      this.#cropModal.reset(schedule)
    }
  }

  applyCropSettings(): void {
    this.#cropModal.apply()
  }

  // =============================================================================
  // DEVICE PRESET OPERATIONS
  // =============================================================================

  applyDevicePreset(): void {
    this.#devicePresetsManager.applyDevicePreset()
  }

  applyDashboardSelection(): void {
    this.#devicePresetsManager.applyDashboardSelection()
  }

  // =============================================================================
  // HA MODE TOGGLE
  // =============================================================================

  /**
   * Toggles between Home Assistant mode and Generic URL mode.
   * Saves the mode to config and refreshes the UI.
   */
  async toggleHAMode(enabled: boolean): Promise<void> {
    // Clear target_url when switching to HA mode
    if (enabled) {
      const targetUrlInput = document.getElementById(
        's_target_url'
      ) as HTMLInputElement | null
      if (targetUrlInput) targetUrlInput.value = ''
    }

    // Save the schedule with new ha_mode value and re-render
    await this.updateScheduleFromForm()
  }

  // =============================================================================
  // ERROR HANDLING
  // =============================================================================

  #showError(message: string): void {
    const content = document.getElementById('tabContent')
    if (content) {
      content.innerHTML = `<p class="text-red-500 text-center py-8">${message}</p>`
    }
  }
}

// =============================================================================
// INITIALIZATION
// =============================================================================

window.app = new App()

window.addEventListener('load', () => {
  window.app.init()
})
