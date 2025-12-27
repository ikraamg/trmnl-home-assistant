/* global document, window */
/**
 * Device Presets Manager Module
 *
 * Manages device presets and Home Assistant integration features.
 * Bridges TRMNL add-on configuration with Home Assistant runtime state.
 *
 * Design Pattern:
 * Integration Adapter Pattern - adapts external HA state (window.hass) to internal forms.
 * Each picker method (theme, dashboard, language) queries window.hass independently.
 *
 * Home Assistant Integration:
 * Reads runtime state from global window.hass object (injected by HA iframe).
 * Three HA integration points:
 * 1. Themes: window.hass.themes.themes (user-installed theme list)
 * 2. Dashboards: window.hass.dashboards (available dashboard paths)
 * 3. Language: window.hass.config.language (user's configured language)
 *
 * Fallback Strategy:
 * All HA integrations are defensive - graceful degradation if window.hass unavailable.
 * Dashboard picker falls back to hardcoded defaults ['/lovelace/0', '/home'].
 * Theme picker shows "Default" option only if no themes available.
 * Language prefill skipped if HA config unavailable.
 *
 * Device Preset Structure:
 * Presets loaded from backend API (presets.json).
 * Each preset defines:
 * - name: Display name (e.g., "TRMNL 800×480")
 * - viewport: {width, height} dimensions
 * - rotate: Optional rotation angle (90, 180, 270)
 * - format: Optional image format (png, jpeg, webp)
 *
 * Event Dispatching Pattern:
 * After updating input values, dispatches 'change' events manually.
 * Triggers app.js listeners for auto-preview refresh.
 * Required because programmatic value changes don't fire events automatically.
 *
 * DOM Re-rendering Support:
 * afterDOMRender() method consolidates 4 separate operations into one call.
 * Called after app.js re-renders DOM (schedule tab switch).
 * Restores all dropdown state: presets, themes, dashboards, language.
 *
 * Dataset Pattern:
 * Stores preset data in <option> elements via dataset.device (JSON string).
 * Avoids separate lookup table - data travels with DOM element.
 * Parsed on demand when preset applied.
 *
 * Why window.hass?:
 * HA provides JavaScript API to iframes via window.hass global.
 * This is the official integration method for HA add-on UIs.
 * Provides reactive access to themes, dashboards, config without polling.
 *
 * NOTE: window.hass only available when running inside Home Assistant.
 * Standalone testing requires mock window.hass object.
 * AI: When adding HA integrations, always provide fallback behavior.
 *
 * @module html/js/device-presets
 */

import { LoadPresets } from './api-client.js'

/**
 * Manager coordinating device presets and Home Assistant integration.
 *
 * Responsibilities:
 * - Load and render device preset dropdown
 * - Apply preset configuration to form inputs
 * - Populate theme picker from HA themes
 * - Populate dashboard picker from HA dashboards
 * - Prefill language from HA config
 * - Restore state after DOM re-renders
 *
 * HA Integration Philosophy:
 * Defensive programming - all HA integrations have fallback behavior.
 * Never crashes if window.hass unavailable (standalone testing).
 * Logs warnings but continues operation.
 *
 * @class
 */
export class DevicePresetsManager {
  // Command instance (dependency injection)
  #loadPresetsCmd

  // Cached presets (object keyed by preset ID)
  #presets = {}

  /**
   * Creates manager and initializes preset command.
   */
  constructor() {
    this.#loadPresetsCmd = new LoadPresets()
  }

  /**
   * Loads device presets from API and renders dropdown options.
   *
   * Error Handling:
   * Logs warning but doesn't throw on failure.
   * Dropdown shows only "Custom Configuration" if presets fail to load.
   *
   * @returns {Promise<void>} Resolves after presets loaded and rendered
   */
  async loadAndRenderPresets() {
    try {
      this.#presets = await this.#loadPresetsCmd.call()
      this.#renderPresetOptions()
    } catch (err) {
      console.warn('Failed to load presets:', err)
    }
  }

  /**
   * Renders device preset <option> elements in dropdown.
   *
   * Dropdown Structure:
   * First option: "Custom Configuration" (value="", always present)
   * Subsequent options: Device presets from API
   *
   * Dataset Pattern:
   * Stores full preset object in option.dataset.device as JSON string.
   * Data embedded in DOM - no separate lookup when applying preset.
   *
   * Re-render Safe:
   * Clears existing options (except first) before adding new ones.
   * Called both on initial load and after DOM re-renders.
   */
  #renderPresetOptions() {
    const select = document.getElementById('devicePreset')
    if (!select) return

    // Clear existing options except the first "Custom Configuration" option
    while (select.options.length > 1) {
      select.remove(1)
    }

    // Add preset options
    Object.entries(this.#presets).forEach(([presetId, preset]) => {
      const option = document.createElement('option')
      option.value = presetId
      option.textContent = preset.name || presetId
      option.dataset.device = JSON.stringify(preset)
      select.appendChild(option)
    })
  }

  /**
   * Public alias for #renderPresetOptions().
   * Allows caller to trigger re-render after DOM changes.
   */
  renderPresets() {
    this.#renderPresetOptions()
  }

  /**
   * Restores all dropdown state after DOM re-render.
   *
   * Convenience Method:
   * Consolidates 4 operations into single call (easier for app.js).
   * Called after tab switch re-renders schedule form DOM.
   *
   * Operations:
   * 1. Re-render preset dropdown (restores <option> elements)
   * 2. Populate theme picker with HA themes (dynamic from window.hass)
   * 3. Populate dashboard picker with HA dashboards (dynamic from window.hass)
   * 4. Prefill language from HA config (if empty)
   *
   * Why Needed?:
   * app.js re-renders entire schedule form on tab switch.
   * Dropdowns lose their populated options during re-render.
   * This method restores all dynamic content.
   *
   * @param {Object} [schedule] - Current schedule (for theme selection)
   */
  afterDOMRender(schedule) {
    this.renderPresets()
    this.populateThemePicker(schedule?.theme)
    this.populateDashboardPicker()
    this.prefillLanguage()
  }

  /**
   * Applies selected device preset to form inputs.
   *
   * Application Flow:
   * 1. Parse preset data from <option> dataset
   * 2. Update viewport width/height inputs
   * 3. Update rotation select (if specified)
   * 4. Update format select (if specified)
   * 5. Show device info banner with preset details
   * 6. Dispatch 'change' events to trigger preview refresh
   *
   * Event Dispatching:
   * Manually dispatches 'change' events after updating values.
   * Required because programmatic value changes don't fire events.
   * Triggers app.js listeners for auto-preview generation.
   *
   * Info Banner:
   * Shows preset name, dimensions, and rotation (if any).
   * Hidden when "Custom Configuration" selected.
   *
   * Custom Configuration Handling:
   * If first option (value="") selected, hides banner and returns false.
   * Allows user to manually configure viewport without preset.
   *
   * @returns {boolean} True if preset applied, false if custom config selected
   */
  applyDevicePreset() {
    const select = document.getElementById('devicePreset')
    if (!select) return false

    const option = select.options[select.selectedIndex]

    // Hide device info if "Custom Configuration" is selected
    if (!option.value) {
      document.getElementById('deviceInfo')?.classList.add('hidden')
      return false
    }

    // Parse device data
    const device = JSON.parse(option.dataset.device)

    // Auto-fill viewport dimensions
    const widthInput = document.getElementById('s_width')
    const heightInput = document.getElementById('s_height')

    if (widthInput && device.viewport?.width) {
      widthInput.value = device.viewport.width
      widthInput.dispatchEvent(new Event('change'))
    }

    if (heightInput && device.viewport?.height) {
      heightInput.value = device.viewport.height
      heightInput.dispatchEvent(new Event('change'))
    }

    // Auto-fill rotation if specified
    if (device.rotate) {
      const rotateSelect = document.getElementById('s_rotate')
      if (rotateSelect) {
        rotateSelect.value = device.rotate
        rotateSelect.dispatchEvent(new Event('change'))
      }
    }

    // Auto-fill format if specified
    if (device.format) {
      const formatSelect = document.getElementById('s_format')
      if (formatSelect) {
        formatSelect.value = device.format
        formatSelect.dispatchEvent(new Event('change'))
      }
    }

    // Show device info banner
    const infoDiv = document.getElementById('deviceInfo')
    const infoPara = infoDiv?.querySelector('p')
    if (infoPara) {
      infoPara.textContent = `Using ${device.name}: ${device.viewport.width}x${
        device.viewport.height
      }${device.rotate ? `, ${device.rotate}° rotation` : ''}`
    }
    infoDiv?.classList.remove('hidden')

    return true
  }

  /**
   * Populates theme dropdown from Home Assistant themes.
   *
   * HA Integration:
   * Reads themes from window.hass.themes.themes (global HA state).
   * This object contains all user-installed themes in HA.
   *
   * Fallback Behavior:
   * If window.hass unavailable, logs warning and shows "Default" only.
   * Graceful degradation for standalone testing.
   *
   * Theme Selection:
   * Marks selectedTheme as selected (for restoring schedule state).
   * Used when loading existing schedule with theme configured.
   *
   * Sorting:
   * Themes sorted alphabetically for easier browsing.
   * "Default" option always first (no theme override).
   *
   * @param {string|null} [selectedTheme] - Theme to pre-select (optional)
   */
  populateThemePicker(selectedTheme = null) {
    const themeSelect = document.getElementById('s_theme')
    if (!themeSelect) return

    // Clear existing options
    themeSelect.innerHTML = '<option value="">Default</option>'

    // Check if themes are available from window.hass
    if (!window.hass?.themes?.themes) {
      console.warn('No themes found in window.hass')
      return
    }

    // Add theme options (sorted alphabetically)
    Object.keys(window.hass.themes.themes)
      .sort()
      .forEach((theme) => {
        const option = document.createElement('option')
        option.value = theme
        option.textContent = theme
        if (theme === selectedTheme) {
          option.selected = true
        }
        themeSelect.appendChild(option)
      })
  }

  /**
   * Auto-fills language field from Home Assistant configuration.
   *
   * HA Integration:
   * Reads language from window.hass.config.language (user's HA language).
   * Common values: 'en', 'de', 'fr', 'es', etc.
   *
   * Conditional Prefill:
   * Only fills if input currently empty AND HA has language configured.
   * Respects user's manual input (doesn't overwrite).
   *
   * Placeholder Update:
   * Sets both value and placeholder to HA language.
   * Placeholder shows even if field cleared (helpful hint).
   *
   * Use Case:
   * Ensures screenshot language matches user's HA language.
   * Useful for dashboards with localized text.
   */
  prefillLanguage() {
    const langInput = document.getElementById('s_lang')
    if (!langInput) return

    // Only prefill if field is empty and HA has a language configured
    if (window.hass?.config?.language && !langInput.value) {
      langInput.value = window.hass.config.language
      langInput.placeholder = window.hass.config.language
    }
  }

  /**
   * Populates dashboard dropdown from Home Assistant dashboards.
   *
   * HA Integration:
   * Reads dashboards from window.hass.dashboards (array of dashboard paths).
   * Paths like '/lovelace/0', '/home', '/lovelace/kitchen', etc.
   *
   * Fallback Behavior:
   * If window.hass unavailable, provides hardcoded defaults.
   * Default paths: ['/lovelace/0', '/home']
   * Ensures dropdown always has options even in standalone mode.
   *
   * Dropdown Structure:
   * First option: Placeholder "Select a dashboard..." (value="")
   * Subsequent options: Dashboard paths from HA or defaults
   *
   * Re-render Safe:
   * Clears existing options (except first) before populating.
   * Called on initial load and after DOM re-renders.
   */
  populateDashboardPicker() {
    const select = document.getElementById('dashboardSelector')
    if (!select) return

    // Clear existing options except the first placeholder option
    while (select.options.length > 1) {
      select.remove(1)
    }

    // Check if dashboards are available from window.hass
    if (!window.hass?.dashboards || !Array.isArray(window.hass.dashboards)) {
      console.warn('No dashboards found in window.hass - using defaults')

      // Add default options as fallback
      const defaults = ['/lovelace/0', '/home']
      defaults.forEach((path) => {
        const option = document.createElement('option')
        option.value = path
        option.textContent = path
        select.appendChild(option)
      })
      return
    }

    // Add dashboard options
    window.hass.dashboards.forEach((path) => {
      const option = document.createElement('option')
      option.value = path
      option.textContent = path
      select.appendChild(option)
    })
  }

  /**
   * Copies selected dashboard path to dashboard input field.
   *
   * Picker-to-Input Pattern:
   * Dropdown is a picker (convenience), not the actual form field.
   * User selects dashboard → path copied to actual input → dropdown resets.
   * Allows picking multiple times without losing previous selection.
   *
   * Workflow:
   * 1. User selects dashboard from dropdown
   * 2. Path copied to s_path input field
   * 3. Change event dispatched (triggers preview refresh)
   * 4. Dropdown resets to placeholder (ready for next pick)
   *
   * Event Dispatching:
   * Dispatches 'change' event after updating input.
   * Triggers app.js listeners for auto-preview generation.
   * Required because programmatic value changes don't fire events.
   *
   * Placeholder Handling:
   * Returns false if placeholder selected (value="").
   * No action taken - pathInput unchanged.
   *
   * Reset Behavior:
   * Resets dropdown to placeholder after copying.
   * UX pattern: dropdown is a tool, not persistent state.
   *
   * @returns {boolean} True if dashboard path copied, false if placeholder selected
   */
  applyDashboardSelection() {
    const select = document.getElementById('dashboardSelector')
    const pathInput = document.getElementById('s_path')

    if (!select || !pathInput) return false

    // If a dashboard was selected (not the placeholder)
    if (select.value) {
      pathInput.value = select.value
      pathInput.dispatchEvent(new Event('change'))

      // Reset selector back to placeholder after copying (ready for next pick)
      select.value = ''
      return true
    }

    return false
  }
}
