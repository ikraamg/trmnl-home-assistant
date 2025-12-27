/* global document, window */
/**
 * TRMNL HA Schedule Manager - Main Application Module
 *
 * Front-end orchestrator coordinating all UI modules and user interactions.
 * Exposes global app instance (window.app) for HTML onclick handlers.
 *
 * Responsibilities:
 * 1. Module Coordination - Owns and delegates to specialized modules
 * 2. UI Lifecycle - Initialization, rendering, error handling
 * 3. User Actions - CRUD operations, preview generation, modal management
 * 4. State Synchronization - Form inputs ↔ schedule data
 *
 * Architecture Pattern:
 * Façade pattern - presents simple API to HTML while coordinating complex subsystems.
 * HTML calls app.createSchedule(), app.deleteSchedule(), etc.
 * App delegates to ScheduleManager, PreviewGenerator, modals, etc.
 *
 * Module Ownership:
 * - ScheduleManager: CRUD operations, state management
 * - PreviewGenerator: Screenshot preview with auto-refresh
 * - CropModal: Interactive crop/zoom UI (Interact.js integration)
 * - ConfirmModal: Promise-based confirmation dialogs
 * - DevicePresetsManager: Device/dashboard preset application
 *
 * HTML Integration:
 * UI templates use inline event handlers like onclick="app.createSchedule()".
 * Field IDs prefixed with "s_" (e.g., s_name, s_cron, s_width).
 * App finds DOM elements by these IDs to read/write form state.
 *
 * State Management:
 * Two-way binding between form inputs and schedule objects:
 * - Form changes → updateField() → ScheduleManager → API → re-render
 * - Schedule changes → renderUI() → DOM updates → form inputs populated
 *
 * Auto-Refresh Pattern:
 * Many operations check this.#previewGenerator.autoRefresh after updates.
 * If enabled, automatically regenerates preview to show changes.
 * Provides instant visual feedback without manual "Load Preview" clicks.
 *
 * Error Handling:
 * User-facing errors shown via ConfirmModal.alert() (modal dialogs).
 * Console errors logged for debugging but not shown to user.
 * Graceful degradation - failed operations don't crash app.
 *
 * Global Exposure:
 * window.app = new App() exposes single instance globally.
 * Required for HTML onclick handlers to reference app methods.
 * Alternative: Use event delegation (not implemented here for simplicity).
 *
 * NOTE: This is the only module that touches window global.
 * AI: When adding features, follow delegation pattern (create module, call from App).
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

/**
 * Main application class coordinating all UI modules.
 *
 * Façade Pattern:
 * Simple public API hiding complex module interactions.
 * HTML calls app.method() → App delegates to appropriate module.
 *
 * Module Lifecycle:
 * All modules created in constructor (eager initialization).
 * Modules are stateful - same instances reused throughout session.
 *
 * Public API (called from HTML):
 * - CRUD: createSchedule(), selectSchedule(), deleteSchedule()
 * - Updates: updateField(), updateScheduleFromForm()
 * - Preview: loadPreview(), toggleAutoRefresh()
 * - Modals: openCropModal(), sendNow()
 * - Presets: applyDevicePreset(), applyDashboardSelection()
 *
 * @class
 */
class App {
  // Private fields
  #scheduleManager
  #previewGenerator
  #cropModal
  #confirmModal
  #devicePresetsManager

  /**
   * Creates app instance and initializes all modules (does not load data yet).
   */
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

  /**
   * Initializes application by loading schedules and rendering UI.
   *
   * Startup Sequence:
   * 1. Load schedules from API via ScheduleManager
   * 2. Render tabs + content (or empty state if no schedules)
   * 3. Load device presets and populate dropdown
   * 4. Restore auto-refresh checkbox state from PreviewGenerator
   *
   * Error Handling:
   * Displays generic error message if schedule loading fails.
   * Doesn't rethrow - allows app to render even if API fails.
   *
   * Called On:
   * window 'load' event (see bottom of file).
   *
   * @returns {Promise<void>}
   */
  async init() {
    try {
      await this.#scheduleManager.loadAll()
      this.renderUI()

      // Load device presets
      await this.#devicePresetsManager.loadAndRenderPresets()

      // Set auto-refresh checkbox state
      const autoRefreshCheckbox = document.getElementById('autoRefreshToggle')
      if (autoRefreshCheckbox) {
        autoRefreshCheckbox.checked = this.#previewGenerator.autoRefresh
      }
    } catch (err) {
      console.error('Error initializing app:', err)
      this.#showError('Failed to load schedules')
    }
  }

  // =============================================================================
  // SCHEDULE OPERATIONS
  // =============================================================================

  /**
   * Creates new schedule and refreshes UI.
   *
   * Delegates to ScheduleManager.create() which:
   * - Generates new schedule with default values
   * - POSTs to /api/schedules
   * - Adds to local schedules array
   * - Selects as active schedule
   *
   * Re-renders entire UI (tabs + content) to show new schedule tab.
   *
   * Error Handling:
   * Shows modal error dialog if creation fails.
   * Logs to console for debugging.
   *
   * Called From: HTML "New Schedule" button
   *
   * @returns {Promise<void>}
   */
  async createSchedule() {
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

  /**
   * Selects a schedule by ID
   */
  selectSchedule(id) {
    this.#scheduleManager.selectSchedule(id)
    this.renderUI()
  }

  /**
   * Deletes a schedule after confirmation
   */
  async deleteSchedule(id) {
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

  /**
   * Updates single field on active schedule with auto-refresh.
   *
   * Field Update Pattern:
   * Used for inline edits (e.g., onchange="app.updateField('name', this.value)").
   * Merges single field into schedule object and PUTs to API.
   *
   * Selective Re-render:
   * Only re-renders full UI if 'enabled' field changed (affects tab green dot).
   * Other fields skip re-render to avoid cursor jumping in text inputs.
   *
   * Auto-Refresh Integration:
   * If PreviewGenerator.autoRefresh enabled, regenerates preview automatically.
   * Provides instant visual feedback as user edits fields.
   *
   * Use vs. updateScheduleFromForm():
   * - updateField(): Single field from inline handler
   * - updateScheduleFromForm(): All fields from bulk update
   *
   * @param {string} field - Field name to update (e.g., 'name', 'cron', 'enabled')
   * @param {any} value - New value for field
   * @returns {Promise<void>}
   */
  async updateField(field, value) {
    const schedule = this.#scheduleManager.activeSchedule
    if (!schedule) return

    const updates = { ...schedule, [field]: value }
    await this.#scheduleManager.update(schedule.id, updates)

    // Re-render tabs if enabled status changed (to show/hide green dot)
    if (field === 'enabled') {
      this.renderUI()
    }

    // Auto-refresh preview if enabled
    if (this.#previewGenerator.autoRefresh) {
      this.loadPreview()
    }
  }

  /**
   * Manually triggers screenshot capture and webhook delivery ("Send Now" button).
   *
   * Flow:
   * 1. Disable button, show "Sending..." loading state
   * 2. POST to /api/schedules/:id/send (manual execution endpoint)
   * 3. Show success/error feedback on button (✓ Sent! / ✗ Failed)
   * 4. Show modal dialog with detailed result
   * 5. Reset button to original state after modal closes
   *
   * Button State Management:
   * Manipulates button DOM directly for instant visual feedback.
   * Stores original text and background color for restoration.
   * Guards against DOM removal during async operations (button may be removed if tab switched).
   *
   * Error Handling:
   * Network errors, HTTP errors, webhook failures all caught and shown to user.
   * Button shows error state (red background) before modal appears.
   * Always resets button state after modal dismissal.
   *
   * Use Case:
   * Testing webhook configuration without waiting for cron schedule.
   * Immediately updating TRMNL display after config changes.
   *
   * @param {string} scheduleId - Schedule UUID to execute
   * @param {Event} event - Click event (to access button element)
   * @returns {Promise<void>}
   */
  async sendNow(scheduleId, event) {
    const button = event.target
    const originalText = button.textContent
    const originalBgColor = button.style.backgroundColor

    try {
      // Disable button and show loading state
      button.disabled = true
      button.textContent = 'Sending...'
      button.style.opacity = '0.6'
      button.style.cursor = 'not-allowed'

      const response = await fetch(`./api/schedules/${scheduleId}/send`, {
        method: 'POST',
      })

      // Get response text first to handle parsing errors gracefully
      const responseText = await response.text()
      let result

      try {
        result = JSON.parse(responseText)
      } catch (_parseError) {
        console.error('Failed to parse response:', responseText)
        throw new Error(
          `Server returned invalid response: ${responseText.substring(0, 100)}`
        )
      }

      if (!response.ok) {
        throw new Error(result.error || 'Failed to send webhook')
      }

      // Show success feedback
      button.textContent = '✓ Sent!'
      button.style.backgroundColor = '#10b981' // green
      button.style.opacity = '1'

      // Show success modal with details
      await this.#confirmModal.alert({
        title: '✓ Success!',
        message: 'Screenshot captured and sent to webhook successfully!',
        type: 'success',
      })

      // Reset button after modal closes
      // Check if button still exists in DOM before modifying
      if (document.body.contains(button)) {
        button.textContent = originalText
        button.style.backgroundColor = originalBgColor
        button.disabled = false
        button.style.opacity = ''
        button.style.cursor = ''
      }
    } catch (err) {
      console.error('Error sending webhook:', err)

      // Show error state on button
      if (document.body.contains(button)) {
        button.textContent = '✗ Failed'
        button.style.backgroundColor = '#ef4444' // red
        button.style.opacity = '1'
      }

      // Show error modal
      await this.#confirmModal.alert({
        title: '✗ Error',
        message: `Failed to send webhook: ${err.message}`,
        type: 'error',
      })

      // Reset button after modal closes
      if (document.body.contains(button)) {
        button.textContent = originalText
        button.style.backgroundColor = originalBgColor
        button.disabled = false
        button.style.opacity = ''
        button.style.cursor = ''
      }
    }
  }

  /**
   * Updates the entire schedule from form inputs
   */
  async updateScheduleFromForm() {
    const schedule = this.#scheduleManager.activeSchedule
    if (!schedule) return

    // Track if name changed (to update tab UI)
    const oldName = schedule.name

    // Build updates object from all form fields
    const updates = this.#buildScheduleUpdates(schedule)

    await this.#scheduleManager.update(schedule.id, updates)

    // Re-render tabs if name changed
    if (oldName !== updates.name) {
      this.renderUI()
    } else {
      // Just re-render content
      this.#renderScheduleContent()
    }

    // Auto-refresh preview if enabled
    if (this.#previewGenerator.autoRefresh) {
      this.loadPreview()
    }
  }

  /**
   * Builds schedule updates object from form inputs
   */
  #buildScheduleUpdates(schedule) {
    return {
      ...schedule,
      name: document.getElementById('s_name')?.value || schedule.name,
      cron: document.getElementById('s_cron')?.value || schedule.cron,
      webhook_url: document.getElementById('s_webhook')?.value || null,
      dashboard_path:
        document.getElementById('s_path')?.value || schedule.dashboard_path,
      viewport: {
        width:
          parseInt(document.getElementById('s_width')?.value) ||
          schedule.viewport.width,
        height:
          parseInt(document.getElementById('s_height')?.value) ||
          schedule.viewport.height,
      },
      crop: {
        enabled: document.getElementById('s_crop_enabled')?.checked || false,
        x: parseInt(document.getElementById('s_crop_x')?.value) || 0,
        y: parseInt(document.getElementById('s_crop_y')?.value) || 0,
        width:
          parseInt(document.getElementById('s_crop_width')?.value) ||
          schedule.viewport.width,
        height:
          parseInt(document.getElementById('s_crop_height')?.value) ||
          schedule.viewport.height,
      },
      format: document.getElementById('s_format')?.value || schedule.format,
      rotate: this.#parseRotation(document.getElementById('s_rotate')?.value),
      zoom: parseFloat(document.getElementById('s_zoom')?.value) || 1,
      wait: this.#parseWait(document.getElementById('s_wait')?.value),
      theme: document.getElementById('s_theme')?.value || null,
      lang: document.getElementById('s_lang')?.value || null,
      dark: document.getElementById('s_dark')?.checked || false,
      invert: document.getElementById('s_invert')?.checked || false,
      dithering: {
        enabled: document.getElementById('s_dithering')?.checked || false,
        method: document.getElementById('s_method')?.value || 'floyd-steinberg',
        palette: document.getElementById('s_palette')?.value || 'gray-4',
        gammaCorrection: document.getElementById('s_gamma')?.checked ?? true,
        blackLevel: parseInt(document.getElementById('s_black')?.value) || 0,
        whiteLevel: parseInt(document.getElementById('s_white')?.value) || 100,
        normalize: document.getElementById('s_normalize')?.checked || false,
        saturationBoost:
          document.getElementById('s_saturation')?.checked || false,
      },
    }
  }

  #parseRotation(value) {
    return value ? parseInt(value) : null
  }

  #parseWait(value) {
    return value ? parseInt(value) : null
  }

  // =============================================================================
  // UI RENDERING
  // =============================================================================

  /**
   * Renders the complete UI (tabs + content)
   */
  renderUI() {
    const schedules = this.#scheduleManager.schedules
    const activeId = this.#scheduleManager.activeScheduleId

    // Render tabs
    new RenderTabs(schedules, activeId).call()

    // Render content or empty state
    if (this.#scheduleManager.isEmpty()) {
      new RenderEmptyState().call()
    } else {
      this.#renderScheduleContent()
    }
  }

  /**
   * Renders just the schedule content panel
   */
  #renderScheduleContent() {
    const schedule = this.#scheduleManager.activeSchedule
    if (schedule) {
      new RenderScheduleContent(schedule).call()

      // Restore state after DOM replacement
      // Note: If you add new dropdowns, add them to DevicePresetsManager.afterDOMRender()
      this.#devicePresetsManager.afterDOMRender(schedule)

      // Set auto-refresh checkbox (may have been re-rendered)
      const autoRefreshCheckbox = document.getElementById('autoRefreshToggle')
      if (autoRefreshCheckbox) {
        autoRefreshCheckbox.checked = this.#previewGenerator.autoRefresh
      }
    }
  }

  // =============================================================================
  // PREVIEW OPERATIONS
  // =============================================================================

  /**
   * Toggles auto-refresh for previews
   */
  toggleAutoRefresh(enabled) {
    this.#previewGenerator.toggleAutoRefresh(enabled)

    if (enabled) {
      this.loadPreview()
    }
  }

  /**
   * Loads and displays preview for active schedule
   */
  async loadPreview() {
    const schedule = this.#scheduleManager.activeSchedule
    if (!schedule) return

    await this.#previewGenerator.call(schedule)
  }

  // =============================================================================
  // CROP MODAL OPERATIONS
  // =============================================================================

  /**
   * Opens the crop & zoom modal
   */
  async openCropModal() {
    const schedule = this.#scheduleManager.activeSchedule
    if (!schedule) return

    await this.#cropModal.open(schedule, async (cropSettings) => {
      // Update schedule with new crop settings
      const updates = { ...schedule, crop: cropSettings }
      await this.#scheduleManager.update(schedule.id, updates)

      // Update form inputs
      this.#updateCropFormInputs(cropSettings)

      // Auto-refresh preview if enabled
      if (this.#previewGenerator.autoRefresh) {
        this.loadPreview()
      }
    })
  }

  /**
   * Updates crop form inputs with new values
   */
  #updateCropFormInputs(crop) {
    const cropEnabledInput = document.getElementById('s_crop_enabled')
    const cropXInput = document.getElementById('s_crop_x')
    const cropYInput = document.getElementById('s_crop_y')
    const cropWidthInput = document.getElementById('s_crop_width')
    const cropHeightInput = document.getElementById('s_crop_height')

    if (cropEnabledInput) cropEnabledInput.checked = crop.enabled
    if (cropXInput) cropXInput.value = crop.x
    if (cropYInput) cropYInput.value = crop.y
    if (cropWidthInput) cropWidthInput.value = crop.width
    if (cropHeightInput) cropHeightInput.value = crop.height
  }

  /**
   * Closes the crop modal
   */
  closeCropModal() {
    this.#cropModal.close()
  }

  /**
   * Resets crop to full viewport
   */
  resetCrop() {
    const schedule = this.#scheduleManager.activeSchedule
    if (schedule) {
      this.#cropModal.reset(schedule)
    }
  }

  /**
   * Fits crop to device aspect ratio
   */
  fitToDevice() {
    const schedule = this.#scheduleManager.activeSchedule
    if (schedule) {
      // For now, just reset - future: calculate based on device
      this.#cropModal.reset(schedule)
    }
  }

  /**
   * Applies crop settings and closes modal
   */
  applyCropSettings() {
    this.#cropModal.apply()
  }

  // =============================================================================
  // DEVICE PRESET OPERATIONS
  // =============================================================================

  /**
   * Applies the selected device preset
   */
  applyDevicePreset() {
    this.#devicePresetsManager.applyDevicePreset()
  }

  /**
   * Applies the selected dashboard
   */
  applyDashboardSelection() {
    this.#devicePresetsManager.applyDashboardSelection()
  }

  // =============================================================================
  // ERROR HANDLING
  // =============================================================================

  #showError(message) {
    const content = document.getElementById('tabContent')
    if (content) {
      content.innerHTML = `<p class="text-red-500 text-center py-8">${message}</p>`
    }
  }
}

// =============================================================================
// INITIALIZATION
// =============================================================================

// Create global app instance
window.app = new App()

// Initialize when DOM is ready
window.addEventListener('load', () => {
  window.app.init()
})
