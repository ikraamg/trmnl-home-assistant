/* global document */
/**
 * UI Renderer Module - Pure View Layer (Template Generation)
 *
 * Generates all HTML templates for the schedule editor UI. This module is a pure
 * view layer with NO business logic - all data manipulation happens in other modules
 * (app.js, schedule-manager.js, preview-generator.js).
 *
 * Architecture:
 * - Three main render classes: RenderTabs, RenderEmptyState, RenderScheduleContent
 * - Each class is command-pattern: instantiate with data, call .call() to render
 * - All event handlers delegate to window.app.* methods (defined in app.js)
 * - Uses inline styles with CSS variables (--primary, --primary-dark, --primary-light)
 * - Tailwind CSS classes for layout and spacing
 *
 * Template Structure:
 * - 3-column layout: Settings (left), Preview (right, sticky)
 * - Settings divided into: Schedule, Screenshot, Dithering sections
 * - Screenshot section: ~250 lines with 10+ subsections (viewport, crop, format, theme, etc.)
 * - Dithering section: ~130 lines with 8 controls (method, palette, gamma, levels, etc.)
 *
 * Key Patterns:
 * - Conditional rendering: Uses ternary operators for show/hide logic
 * - Dynamic field IDs: All inputs have "s_" prefix (e.g., "s_name", "s_cron")
 * - Fallback values: Uses || operators for missing schedule data
 * - Helper text: Every field has gray text explaining purpose/format
 *
 * NOTE: This file is 650+ lines of mostly HTML strings. Focus on class-level docs.
 * AI: When modifying templates, preserve "s_" field ID prefix - app.js depends on it.
 *
 * @module html/js/ui-renderer
 */

/**
 * Renders the tab bar showing all schedules as clickable tabs.
 *
 * Each tab displays:
 * - Schedule name (or "Untitled")
 * - Green dot if enabled (running on schedule)
 * - Active styling for currently selected schedule
 *
 * Command Pattern:
 * Instantiate with data, call .call() to render to DOM.
 *
 * @class
 */
export class RenderTabs {
  /**
   * Creates a tab bar renderer.
   *
   * @param {Array} schedules - Array of schedule objects
   * @param {string} activeScheduleId - ID of currently selected schedule
   * @param {Function} onTabClick - Callback when tab clicked (unused - uses window.app.selectSchedule instead)
   */
  constructor(schedules, activeScheduleId, onTabClick) {
    this.schedules = schedules
    this.activeScheduleId = activeScheduleId
    this.onTabClick = onTabClick
  }

  /**
   * Renders tabs to the #tabBar DOM element.
   *
   * Replaces innerHTML with generated tab HTML.
   */
  call() {
    const tabBar = document.getElementById('tabBar')
    if (!tabBar) return

    tabBar.innerHTML = this.schedules
      .map((schedule) => this.#renderTab(schedule))
      .join('')
  }

  #renderTab(schedule) {
    const isActive = schedule.id === this.activeScheduleId
    const statusDot = schedule.enabled
      ? '<span class="inline-block w-2 h-2 rounded-full bg-green-500 mr-2"></span>'
      : ''

    return `
      <button
        onclick="window.app.selectSchedule('${schedule.id}')"
        class="px-4 py-2 rounded-t-lg font-semibold transition-all ${
          isActive ? 'tab-active' : 'tab-inactive'
        }"
      >
        ${statusDot}${schedule.name || 'Untitled'}
      </button>
    `
  }
}

/**
 * Renders empty state UI when no schedules exist.
 *
 * Displays:
 * - Plus icon graphic
 * - "No Schedules" heading
 * - Explanatory text
 * - "+ New Schedule" button
 *
 * This is the first screen users see before creating their first schedule.
 *
 * @class
 */
export class RenderEmptyState {
  /**
   * Renders empty state to the #tabContent DOM element.
   *
   * Replaces innerHTML with empty state HTML template.
   */
  call() {
    const content = document.getElementById('tabContent')
    if (!content) return

    content.innerHTML = `
      <div class="text-center py-12">
        <svg class="mx-auto h-16 w-16 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
        </svg>
        <h3 class="text-lg font-semibold text-gray-600 mb-2">No Schedules</h3>
        <p class="text-gray-500 mb-4">Create your first schedule to get started</p>
        <button
          onclick="window.app.createSchedule()"
          class="px-6 py-2 text-white rounded-md transition duration-200"
          style="background-color: var(--primary)"
        >
          + New Schedule
        </button>
      </div>
    `
  }
}

/**
 * Renders the complete schedule editor UI with all settings and preview.
 *
 * This is the main view shown when a schedule is selected. Generates a 3-column
 * layout (1-column settings on left, 2-column preview on right).
 *
 * Settings Sections:
 * 1. Schedule Settings (~90 lines): name, cron, webhook, enabled toggle
 * 2. Screenshot Settings (~250 lines): dashboard, viewport, crop, format, rotation,
 *    zoom, wait, theme, language, dark mode, invert
 * 3. Dithering Settings (~130 lines): method, palette, gamma, black/white levels,
 *    normalize, saturation boost
 *
 * Preview Panel (~50 lines):
 * - Auto-refresh toggle
 * - Crop & Zoom button (opens modal)
 * - Refresh button
 * - Loading indicator
 * - Image display with dimensions
 * - Error display
 *
 * All Input Fields:
 * - Have "s_" prefix ID (e.g., "s_name", "s_cron", "s_width")
 * - Call window.app.updateScheduleFromForm() on change
 * - Have helper text explaining purpose/format
 * - Use CSS variables for theming (--primary, --primary-dark, --primary-light)
 *
 * Conditional Rendering:
 * - "Send Now" button only shows if webhook URL configured
 * - Device info banner only shows if device preset selected
 * - Crop note banner always shows to explain dimension behavior
 *
 * NOTE: Template uses 'const s = this.schedule' shorthand throughout for brevity.
 * AI: Preserve field ID prefix "s_" - app.js querySelector logic depends on it.
 *
 * @class
 */
export class RenderScheduleContent {
  /**
   * Creates a schedule content renderer.
   *
   * @param {Object} schedule - Schedule object with all configuration
   */
  constructor(schedule) {
    this.schedule = schedule
  }

  /**
   * Renders schedule content to the #tabContent DOM element.
   *
   * Replaces innerHTML with full schedule editor HTML.
   */
  call() {
    const content = document.getElementById('tabContent')
    if (!content) return

    content.innerHTML = this.#buildTemplate()
  }

  /**
   * Builds the main template with 3-column layout.
   *
   * Layout:
   * - Delete button (top right)
   * - Settings column (left): Schedule + Screenshot + Dithering sections
   * - Preview column (right, sticky): Preview panel with auto-refresh and controls
   *
   * @private
   * @returns {string} Complete HTML template
   */
  #buildTemplate() {
    const s = this.schedule

    return `
      <div class="flex justify-end mb-4">
        <button onclick="window.app.deleteSchedule('${s.id}')"
          class="px-4 py-2 text-red-700 bg-red-100 rounded-md hover:bg-red-200 transition">
          Delete Schedule
        </button>
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Settings Column (1 of 3) -->
        <div class="lg:col-span-1 space-y-4">
          ${this.#renderScheduleSettings()}
          ${this.#renderScreenshotSettings()}
          ${this.#renderDitheringSettings()}
        </div>

        <!-- Preview Column (2 of 3, sticky on scroll) -->
        <div class="lg:col-span-2 lg:sticky lg:top-4 lg:self-start">
          ${this.#renderPreviewPanel()}
        </div>
      </div>
    `
  }

  /**
   * Renders the Schedule settings section.
   *
   * Fields:
   * - Enabled toggle (with visual status indicator)
   * - Name input
   * - Cron expression input (with link to crontab.guru helper)
   * - Webhook URL input
   * - "Send Now" button (conditional - only if webhook configured)
   *
   * @private
   * @returns {string} HTML template for schedule settings
   */
  #renderScheduleSettings() {
    const s = this.schedule
    const enabledClass = s.enabled
      ? 'bg-green-50 border-green-200'
      : 'bg-gray-50 border-gray-200'
    const enabledTextClass = s.enabled ? 'text-green-700' : 'text-gray-600'
    const statusBadge = s.enabled
      ? '<span class="text-xs text-green-600">Running on schedule</span>'
      : ''

    return `
      <div class="border-b pb-4">
        <h3 class="text-lg font-semibold mb-3" style="color: var(--primary-dark)">Schedule</h3>
        <div class="space-y-3">
          <div class="flex items-center justify-between p-3 rounded-md ${enabledClass} border"
               title="When enabled, this schedule will automatically capture and upload screenshots">
            <div class="flex items-center">
              <input type="checkbox" id="s_enabled" ${
                s.enabled ? 'checked' : ''
              }
                class="h-5 w-5 border-gray-300 rounded"
                onchange="window.app.updateField('enabled', this.checked)" />
              <label for="s_enabled" class="ml-2 font-medium ${enabledTextClass}">
                ${s.enabled ? 'Enabled' : 'Disabled'}
              </label>
            </div>
            ${statusBadge}
          </div>
          <p class="text-xs text-gray-500 mt-1">Toggle to activate/pause this schedule's automatic screenshot capture</p>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input type="text" id="s_name" value="${s.name || ''}"
              class="w-full px-3 py-2 border rounded-md" style="border-color: var(--primary-light)"
              onchange="window.app.updateScheduleFromForm()"
              placeholder="e.g., Living Room Display"
              title="Give this schedule a descriptive name to identify it easily" />
            <p class="text-xs text-gray-500 mt-1">Descriptive name for this schedule</p>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Cron Expression</label>
            <input type="text" id="s_cron" value="${s.cron || ''}"
              class="w-full px-3 py-2 border rounded-md font-mono" style="border-color: var(--primary-light)"
              onchange="window.app.updateScheduleFromForm()"
              placeholder="*/10 * * * *"
              title="Unix cron format: minute hour day month weekday" />
            <p class="text-xs text-gray-500 mt-1">
              Schedule timing in cron format (e.g., <code>*/10 * * * *</code> = every 10 minutes).
              <a href="https://crontab.guru" target="_blank" class="underline" style="color: var(--primary)">Use cron helper →</a>
            </p>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Webhook URL</label>
            <input type="url" id="s_webhook" value="${s.webhook_url || ''}"
              class="w-full px-3 py-2 border rounded-md" style="border-color: var(--primary-light)"
              onchange="window.app.updateScheduleFromForm()"
              placeholder="https://your-server.com/upload"
              title="Optional: POST screenshots to this URL when captured" />
            <p class="text-xs text-gray-500 mt-1">Optional: Screenshots will be POSTed to this URL</p>
            ${
              s.webhook_url
                ? `
            <button onclick="window.app.sendNow('${s.id}', event)"
              class="mt-2 px-4 py-2 text-white rounded-md transition hover:opacity-90"
              style="background-color: var(--primary)"
              title="Capture screenshot and send to webhook immediately">
              Send Now
            </button>
            `
                : ''
            }
          </div>
        </div>
      </div>
    `
  }

  /**
   * Renders the Screenshot settings section (largest section with 10+ subsections).
   *
   * Subsections:
   * 1. Dashboard selector (dropdown populated by device-presets.js)
   * 2. Dashboard path input (manual or auto-filled)
   * 3. Device preset selector (dropdown populated by device-presets.js)
   * 4. Device info banner (conditional, shows preset details)
   * 5. Viewport dimensions (width x height)
   * 6. Crop settings (enabled toggle + 4 dimensions + note banner)
   * 7. Format & rotation (PNG/JPEG/BMP + 0°/90°/180°/270°)
   * 8. Zoom & wait (browser zoom + extra wait time for loading)
   * 9. Theme & language (HA theme dropdown + language code)
   * 10. Appearance toggles (dark mode + invert colors)
   *
   * NOTE: Delegates to helper methods for crop, format, zoom, theme, appearance sections.
   *
   * @private
   * @returns {string} HTML template for screenshot settings
   */
  #renderScreenshotSettings() {
    const s = this.schedule

    return `
      <div class="border-b pb-4">
        <h3 class="text-lg font-semibold mb-3" style="color: var(--primary-dark)">Screenshot</h3>
        <div class="space-y-3">
          <!-- Dashboard Selector -->
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">
              Quick Select Dashboard
              <span class="text-gray-500 font-normal text-xs">(Optional - Auto-fills path below)</span>
            </label>
            <select id="dashboardSelector"
              class="w-full px-3 py-2 border rounded-md" style="border-color: var(--primary-light)"
              onchange="window.app.applyDashboardSelection()"
              title="Select from your Home Assistant dashboards">
              <option value="">-- Select a dashboard --</option>
            </select>
            <p class="text-xs text-gray-500 mt-1">Quick select from your HA dashboards</p>
          </div>

          <!-- Dashboard Path -->
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Dashboard Path</label>
            <input type="text" id="s_path" value="${
              s.dashboard_path || '/home'
            }"
              class="w-full px-3 py-2 border rounded-md" style="border-color: var(--primary-light)"
              onchange="window.app.updateScheduleFromForm()"
              placeholder="/lovelace/kitchen"
              title="Home Assistant dashboard path to capture" />
            <p class="text-xs text-gray-500 mt-1">Manual entry or use quick select above</p>
          </div>

          <!-- Device Preset -->
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">
              Device Preset
              <span class="text-gray-500 font-normal text-xs">(Optional - Auto-fills dimensions)</span>
            </label>
            <select id="devicePreset"
              class="w-full px-3 py-2 border rounded-md" style="border-color: var(--primary-light)"
              onchange="window.app.applyDevicePreset()"
              title="Pre-configured settings for common e-ink displays">
              <option value="">Custom Configuration</option>
            </select>
            <p class="text-xs text-gray-500 mt-1">Quick setup for common e-ink displays</p>
          </div>

          <!-- Device Info Banner -->
          <div id="deviceInfo" class="hidden px-4 py-3 rounded-md"
               style="background-color: #fef2f0; border: 1px solid var(--primary-light)">
            <p class="text-sm" style="color: var(--primary-dark)"></p>
          </div>

          <!-- Viewport Dimensions -->
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Width</label>
              <input type="number" id="s_width" value="${
                s.viewport?.width || 768
              }"
                class="w-full px-3 py-2 border rounded-md" style="border-color: var(--primary-light)"
                onchange="window.app.updateScheduleFromForm()"
                title="Screenshot width in pixels" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Height</label>
              <input type="number" id="s_height" value="${
                s.viewport?.height || 1024
              }"
                class="w-full px-3 py-2 border rounded-md" style="border-color: var(--primary-light)"
                onchange="window.app.updateScheduleFromForm()"
                title="Screenshot height in pixels" />
            </div>
          </div>
          <p class="text-xs text-gray-500 mt-1">Viewport dimensions in pixels - should match your e-ink display resolution</p>

          ${this.#renderCropSettings()}
          ${this.#renderFormatSettings()}
          ${this.#renderZoomWaitSettings()}
          ${this.#renderThemeSettings()}
          ${this.#renderAppearanceToggles()}
        </div>
      </div>
    `
  }

  #renderCropSettings() {
    const s = this.schedule

    return `
      <div class="mt-4 p-3 rounded-md" style="background-color: #f9fafb; border: 1px solid #e5e7eb">
        <div class="flex justify-between items-center mb-2">
          <label class="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
            <input type="checkbox" id="s_crop_enabled" ${
              s.crop?.enabled ? 'checked' : ''
            }
              class="h-4 w-4 border-gray-300 rounded"
              onchange="window.app.updateScheduleFromForm()"
              title="Enable crop region" />
            Enable Crop Region
          </label>
        </div>
        <div class="grid grid-cols-4 gap-2">
          <div>
            <label class="block text-xs text-gray-600 mb-1">X</label>
            <input type="number" id="s_crop_x" value="${s.crop?.x || 0}"
              class="w-full px-2 py-1 text-sm border rounded-md" style="border-color: var(--primary-light)"
              onchange="window.app.updateScheduleFromForm()"
              title="Crop offset from left (pixels)" />
          </div>
          <div>
            <label class="block text-xs text-gray-600 mb-1">Y</label>
            <input type="number" id="s_crop_y" value="${s.crop?.y || 0}"
              class="w-full px-2 py-1 text-sm border rounded-md" style="border-color: var(--primary-light)"
              onchange="window.app.updateScheduleFromForm()"
              title="Crop offset from top (pixels)" />
          </div>
          <div>
            <label class="block text-xs text-gray-600 mb-1">Width</label>
            <input type="number" id="s_crop_width" value="${
              s.crop?.width || s.viewport?.width || 768
            }"
              class="w-full px-2 py-1 text-sm border rounded-md" style="border-color: var(--primary-light)"
              onchange="window.app.updateScheduleFromForm()"
              title="Crop width (pixels)" />
          </div>
          <div>
            <label class="block text-xs text-gray-600 mb-1">Height</label>
            <input type="number" id="s_crop_height" value="${
              s.crop?.height || s.viewport?.height || 1024
            }"
              class="w-full px-2 py-1 text-sm border rounded-md" style="border-color: var(--primary-light)"
              onchange="window.app.updateScheduleFromForm()"
              title="Crop height (pixels)" />
          </div>
        </div>
        <p class="text-xs text-gray-500 mt-1">Use "Crop & Zoom" button to visually adjust crop region</p>
        <div class="mt-2 px-3 py-2 rounded-md" style="background-color: #fef3c7; border: 1px solid #fbbf24">
          <p class="text-xs" style="color: #92400e">
            <strong>Note:</strong> When crop is enabled, the final image size will be the crop dimensions (Width × Height), not the viewport size.
          </p>
        </div>
      </div>
    `
  }

  #renderFormatSettings() {
    const s = this.schedule

    return `
      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Format</label>
          <select id="s_format" class="w-full px-3 py-2 border rounded-md" style="border-color: var(--primary-light)"
            onchange="window.app.updateScheduleFromForm()"
            title="Image output format">
            <option value="png" ${
              s.format === 'png' ? 'selected' : ''
            }>PNG</option>
            <option value="jpeg" ${
              s.format === 'jpeg' ? 'selected' : ''
            }>JPEG</option>
            <option value="bmp" ${
              s.format === 'bmp' ? 'selected' : ''
            }>BMP</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Rotation</label>
          <select id="s_rotate" class="w-full px-3 py-2 border rounded-md" style="border-color: var(--primary-light)"
            onchange="window.app.updateScheduleFromForm()"
            title="Rotate image after capture">
            <option value="" ${!s.rotate ? 'selected' : ''}>None</option>
            <option value="90" ${s.rotate === 90 ? 'selected' : ''}>90°</option>
            <option value="180" ${
              s.rotate === 180 ? 'selected' : ''
            }>180°</option>
            <option value="270" ${
              s.rotate === 270 ? 'selected' : ''
            }>270°</option>
          </select>
        </div>
      </div>
      <p class="text-xs text-gray-500 mt-1">PNG (lossless), JPEG (smaller files), or BMP (raw) | Rotate for portrait/landscape displays</p>
    `
  }

  #renderZoomWaitSettings() {
    const s = this.schedule

    return `
      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Zoom</label>
          <input type="number" id="s_zoom" value="${
            s.zoom || 1
          }" step="0.1" min="0.1" max="5"
            class="w-full px-3 py-2 border rounded-md"
            style="border-color: var(--primary-light)"
            onchange="window.app.updateScheduleFromForm()"
            title="Browser zoom level (1.0 = 100%)" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Wait (ms)</label>
          <input type="number" id="s_wait" value="${
            s.wait || ''
          }" min="0" max="30000" step="100"
            class="w-full px-3 py-2 border rounded-md" style="border-color: var(--primary-light)"
            placeholder="Auto"
            onchange="window.app.updateScheduleFromForm()"
            title="Extra delay before screenshot (for slow-loading cards)" />
        </div>
      </div>
      <p class="text-xs text-gray-500 mt-1">Zoom: Scale content (e.g., 0.8 for smaller text) | Wait: Extra loading time for charts/images</p>
    `
  }

  #renderThemeSettings() {
    const s = this.schedule

    return `
      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Theme</label>
          <select id="s_theme"
            class="w-full px-3 py-2 border rounded-md" style="border-color: var(--primary-light)"
            onchange="window.app.updateScheduleFromForm()"
            title="Home Assistant theme to apply">
            <option value="">Default</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Language</label>
          <input type="text" id="s_lang" value="${s.lang || ''}"
            class="w-full px-3 py-2 border rounded-md" style="border-color: var(--primary-light)"
            placeholder="en"
            onchange="window.app.updateScheduleFromForm()"
            title="Language code for Home Assistant UI" />
        </div>
      </div>
      <p class="text-xs text-gray-500 mt-1">Theme: Use HA custom themes | Language: Override HA language (e.g., "en", "fr", "de")</p>
    `
  }

  #renderAppearanceToggles() {
    const s = this.schedule

    return `
      <div class="flex items-center gap-4">
        <label class="flex items-center" title="Force dark mode in Home Assistant">
          <input type="checkbox" id="s_dark" ${s.dark ? 'checked' : ''}
            class="h-4 w-4 border-gray-300 rounded"
            onchange="window.app.updateScheduleFromForm()" />
          <span class="ml-2 text-sm text-gray-700">Dark Mode</span>
        </label>
        <label class="flex items-center" title="Swap black and white after capture (useful for negative displays)">
          <input type="checkbox" id="s_invert" ${s.invert ? 'checked' : ''}
            class="h-4 w-4 border-gray-300 rounded"
            onchange="window.app.updateScheduleFromForm()" />
          <span class="ml-2 text-sm text-gray-700">Invert Colors</span>
        </label>
      </div>
      <p class="text-xs text-gray-500 mt-1">Dark Mode: Forces dark theme | Invert: Flips black↔white (for inverted e-ink displays)</p>
    `
  }

  /**
   * Renders the Dithering settings section (advanced e-ink optimization).
   *
   * Controls:
   * 1. Enable toggle (master switch for all dithering)
   * 2. Method dropdown (Floyd-Steinberg, Ordered, None)
   * 3. Palette dropdown (grayscale: 1/2/4/8-bit, color: Inky 6/7-color)
   * 4. Gamma correction toggle (recommended on)
   * 5. Black level slider (0-50% - crush shadows to pure black)
   * 6. White level slider (50-100% - crush highlights to pure white)
   * 7. Normalize toggle (stretch histogram for max contrast)
   * 8. Saturation boost toggle (increase color vibrancy 50%)
   *
   * @private
   * @returns {string} HTML template for dithering settings
   */
  #renderDitheringSettings() {
    const s = this.schedule

    return `
      <div>
        <h3 class="text-lg font-semibold mb-3" style="color: var(--primary-dark)">Dithering</h3>
        <div class="space-y-3">
          <div class="flex items-center">
            <input type="checkbox" id="s_dithering" ${
              s.dithering?.enabled ? 'checked' : ''
            }
              class="h-4 w-4 border-gray-300 rounded"
              onchange="window.app.updateScheduleFromForm()"
              title="Convert images to limited color palettes for e-ink displays" />
            <label for="s_dithering" class="ml-2 text-sm text-gray-700">Enable Advanced Dithering</label>
          </div>
          <p class="text-xs text-gray-500 mt-1">Optimizes images for e-ink displays by reducing colors and applying error diffusion</p>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Method</label>
            <select id="s_method" class="w-full px-3 py-2 border rounded-md" style="border-color: var(--primary-light)"
              onchange="window.app.updateScheduleFromForm()"
              title="Algorithm for distributing color errors">
              <option value="floyd-steinberg" ${
                s.dithering?.method === 'floyd-steinberg' ? 'selected' : ''
              }>Floyd-Steinberg</option>
              <option value="ordered" ${
                s.dithering?.method === 'ordered' ? 'selected' : ''
              }>Ordered</option>
              <option value="none" ${
                s.dithering?.method === 'none' ? 'selected' : ''
              }>None</option>
            </select>
            <p class="text-xs text-gray-500 mt-1">Floyd-Steinberg (best quality, smooth gradients) | Ordered (faster, crosshatch pattern) | None (hard edges)</p>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Palette</label>
            <select id="s_palette" class="w-full px-3 py-2 border rounded-md" style="border-color: var(--primary-light)"
              onchange="window.app.updateScheduleFromForm()"
              title="Color palette matching your e-ink display capabilities">
              <option value="bw" ${
                s.dithering?.palette === 'bw' ? 'selected' : ''
              }>1-bit (B&W)</option>
              <option value="gray-4" ${
                s.dithering?.palette === 'gray-4' ? 'selected' : ''
              }>2-bit (4 grays)</option>
              <option value="gray-16" ${
                s.dithering?.palette === 'gray-16' ? 'selected' : ''
              }>4-bit (16 grays)</option>
              <option value="gray-256" ${
                s.dithering?.palette === 'gray-256' ? 'selected' : ''
              }>8-bit (256 grays)</option>
              <option value="color-6a" ${
                s.dithering?.palette === 'color-6a' ? 'selected' : ''
              }>6-color (Inky 13.3)</option>
              <option value="color-7a" ${
                s.dithering?.palette === 'color-7a' ? 'selected' : ''
              }>7-color (Inky 7.3)</option>
            </select>
            <p class="text-xs text-gray-500 mt-1">Match your display: 1-bit (classic), 4-grays (TRMNL), 16-grays (high-res), or color (Pimoroni Inky)</p>
          </div>

          <div class="flex items-center">
            <input type="checkbox" id="s_gamma" ${
              s.dithering?.gammaCorrection !== false ? 'checked' : ''
            }
              class="h-4 w-4 border-gray-300 rounded"
              onchange="window.app.updateScheduleFromForm()"
              title="Removes color profiles to linearize brightness for e-ink displays" />
            <label for="s_gamma" class="ml-2 text-sm text-gray-700">Gamma Correction</label>
          </div>
          <p class="text-xs text-gray-500 mt-1">✓ Recommended: Removes gamma curves so e-ink displays show proper brightness</p>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Black Level: <span id="black_val">${
              s.dithering?.blackLevel || 0
            }</span>%</label>
            <input type="range" id="s_black" min="0" max="50" value="${
              s.dithering?.blackLevel || 0
            }"
              class="w-full"
              oninput="document.getElementById('black_val').textContent=this.value"
              onchange="window.app.updateScheduleFromForm()"
              title="Crush darker pixels to pure black for higher contrast" />
            <p class="text-xs text-gray-500 mt-1">Raises shadow detail threshold - pixels darker than this become pure black</p>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">White Level: <span id="white_val">${
              s.dithering?.whiteLevel || 100
            }</span>%</label>
            <input type="range" id="s_white" min="50" max="100" value="${
              s.dithering?.whiteLevel || 100
            }"
              class="w-full"
              oninput="document.getElementById('white_val').textContent=this.value"
              onchange="window.app.updateScheduleFromForm()"
              title="Crush lighter pixels to pure white for cleaner highlights" />
            <p class="text-xs text-gray-500 mt-1">Lowers highlight detail threshold - pixels brighter than this become pure white</p>
          </div>

          <div class="flex items-center gap-4">
            <label class="flex items-center" title="Stretches histogram so darkest pixel→black, brightest→white">
              <input type="checkbox" id="s_normalize" ${
                s.dithering?.normalize ? 'checked' : ''
              }
                class="h-4 w-4 border-gray-300 rounded"
                onchange="window.app.updateScheduleFromForm()" />
              <span class="ml-2 text-sm text-gray-700">Normalize</span>
            </label>
            <label class="flex items-center" title="Boost saturation by 50% for more vivid colors on e-ink">
              <input type="checkbox" id="s_saturation" ${
                s.dithering?.saturationBoost ? 'checked' : ''
              }
                class="h-4 w-4 border-gray-300 rounded"
                onchange="window.app.updateScheduleFromForm()" />
              <span class="ml-2 text-sm text-gray-700">Saturation Boost</span>
            </label>
          </div>
          <p class="text-xs text-gray-500 mt-1">Normalize: Maximizes contrast | Saturation Boost: Makes colors pop 50% more</p>
        </div>
      </div>
    `
  }

  /**
   * Renders the preview panel (right column, sticky on scroll).
   *
   * Components:
   * 1. Header with controls:
   *    - Auto-refresh toggle (persists to localStorage)
   *    - Load time display (shows screenshot generation time)
   *    - "Crop & Zoom" button (opens interactive crop modal)
   *    - "Refresh" button (regenerates preview manually)
   * 2. Preview container with three states:
   *    - Placeholder: "Click Refresh to generate preview" (initial state)
   *    - Loading: Animated spinner with "Generating screenshot..." text
   *    - Image: Screenshot with dimensions display
   * 3. Error message display (hidden by default, shown on failures)
   *
   * Element IDs (manipulated by preview-generator.js):
   * - #autoRefreshToggle - Checkbox for auto-refresh
   * - #loadTime - Span showing generation time
   * - #previewContainer - Container for all preview states
   * - #previewPlaceholder - Initial state message
   * - #loadingIndicator - Loading spinner
   * - #previewImage - Actual screenshot img element
   * - #previewDimensions - Text showing image dimensions
   * - #errorMessage - Error display container
   * - #errorText - Error message text
   *
   * @private
   * @returns {string} HTML template for preview panel
   */
  #renderPreviewPanel() {
    return `
      <div class="flex justify-between items-center mb-4">
        <h3 class="text-lg font-semibold" style="color: var(--primary-dark)">Preview</h3>
        <div class="flex items-center gap-4">
          <label class="flex items-center gap-2 text-sm text-gray-600 cursor-pointer"
                 title="Automatically regenerate preview when settings change">
            <input type="checkbox" id="autoRefreshToggle"
              class="h-4 w-4 border-gray-300 rounded"
              onchange="window.app.toggleAutoRefresh(this.checked)" />
            Auto-refresh
          </label>
          <span id="loadTime" class="text-sm text-gray-500"></span>
          <button onclick="window.app.openCropModal()"
            class="px-4 py-2 border-2 rounded-md transition hover:bg-gray-50"
            style="border-color: var(--primary); color: var(--primary)"
            title="Interactive crop and zoom preview">
            Crop & Zoom
          </button>
          <button onclick="window.app.loadPreview()"
            class="px-4 py-2 text-white rounded-md transition"
            style="background-color: var(--primary)">
            Refresh
          </button>
        </div>
      </div>

      <div id="previewContainer" class="bg-gray-50 rounded-lg p-4 min-h-[400px] preview-container-scroll">
        <div id="previewPlaceholder" class="text-center text-gray-400 flex items-center justify-center min-h-[400px]">
          <div>
            <svg class="mx-auto h-16 w-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p>Click Refresh to generate preview</p>
          </div>
        </div>
        <div id="loadingIndicator" class="hidden text-center flex items-center justify-center min-h-[400px]">
          <div>
            <div class="inline-block animate-spin rounded-full h-12 w-12 border-4 border-t-transparent"
              style="border-color: var(--primary); border-top-color: transparent"></div>
            <p class="mt-4 text-gray-600">Generating screenshot...</p>
          </div>
        </div>
        <img id="previewImage" src="" alt="Preview" class="preview-img hidden" />
        <p id="previewDimensions" class="text-xs text-gray-500 mt-2 text-center hidden"></p>
      </div>

      <div id="errorMessage" class="hidden mt-4 bg-red-50 border border-red-300 text-red-700 px-4 py-3 rounded-md">
        <p id="errorText"></p>
      </div>
    `
  }
}
