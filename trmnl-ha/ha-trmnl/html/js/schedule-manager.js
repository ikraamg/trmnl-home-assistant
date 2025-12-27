/**
 * Schedule Manager Module
 *
 * Business logic layer managing schedule state and CRUD operations.
 * Encapsulates schedule data with controlled access via getters.
 *
 * Design Pattern:
 * Command Pattern Delegation - each CRUD operation delegated to specialized
 * command object (LoadSchedules, CreateSchedule, etc.). Manager coordinates
 * commands and maintains local state consistency.
 *
 * State Management:
 * Maintains two-level state:
 * 1. Collection state: #schedules array (all schedules)
 * 2. Selection state: #activeScheduleId (currently selected schedule)
 *
 * State updates follow optimistic pattern: API call succeeds → update local state.
 * No rollback mechanism (assumes API is authoritative source of truth).
 *
 * Encapsulation Strategy:
 * Private fields (#schedules, #activeScheduleId) prevent external mutation.
 * Bareword getters (get schedules()) provide read-only access.
 * Only manager methods can modify state (create, update, delete).
 *
 * Selection Behavior:
 * Auto-selects first schedule on load if none selected (UX convenience).
 * Auto-selects next available schedule after deletion (prevents null state).
 * Returns null for invalid selections (defensive programming).
 *
 * Default Schedule Structure:
 * New schedules created with sensible defaults:
 * - 10-minute cron interval (frequent updates)
 * - 768×1024 viewport (typical e-ink display)
 * - Floyd-Steinberg dithering with 4-level grayscale
 * - Gamma correction enabled (perceptual quality)
 * - PNG format (lossless)
 *
 * Command Injection:
 * Constructor creates command instances (dependency injection).
 * Enables testing (inject mock commands) and decoupling (commands can change).
 *
 * Why Getters Not Public Fields?:
 * Getters prevent accidental mutation (read-only contract).
 * activeSchedule getter computes on-demand (no stale data).
 * Encapsulation allows future validation/transformation logic.
 *
 * NOTE: No validation layer - assumes API validates schedule data.
 * AI: When adding CRUD operations, maintain local state consistency pattern.
 *
 * @module html/js/schedule-manager
 */

import {
  LoadSchedules,
  CreateSchedule,
  UpdateSchedule,
  DeleteSchedule,
} from './api-client.js'

/**
 * Schedule state manager coordinating CRUD operations and selection.
 *
 * Encapsulation Pattern:
 * Uses ES2022 private fields (#) for complete data hiding.
 * External access only via getters (read-only) and methods (controlled writes).
 *
 * State Consistency:
 * All mutations (create, update, delete) update both API and local state.
 * Local state mirrors API state (optimistic updates, no rollback).
 *
 * @class
 */
export class ScheduleManager {
  // Private state (encapsulated)
  #schedules = []
  #activeScheduleId = null

  // Command instances (dependency injection)
  #loadSchedulesCmd
  #createScheduleCmd
  #updateScheduleCmd
  #deleteScheduleCmd

  /**
   * Creates manager and initializes command objects.
   * Command instances created at construction (dependency injection pattern).
   */
  constructor() {
    // Inject command objects for CRUD operations
    this.#loadSchedulesCmd = new LoadSchedules()
    this.#createScheduleCmd = new CreateSchedule()
    this.#updateScheduleCmd = new UpdateSchedule()
    this.#deleteScheduleCmd = new DeleteSchedule()
  }

  /**
   * Read-only access to all schedules array.
   * Returns reference to internal array (caller should not mutate).
   * @returns {Array<Object>} All schedules
   */
  get schedules() {
    return this.#schedules
  }

  /**
   * Read-only access to active schedule ID.
   * @returns {string|null} ID of selected schedule, or null if none selected
   */
  get activeScheduleId() {
    return this.#activeScheduleId
  }

  /**
   * Computed getter for active schedule object.
   * Finds schedule by ID on-demand (no stale data).
   * @returns {Object|undefined} Active schedule object, or undefined if not found
   */
  get activeSchedule() {
    return this.#schedules.find((s) => s.id === this.#activeScheduleId)
  }

  /**
   * Loads all schedules from API and updates local state.
   *
   * Auto-Selection:
   * If no schedule currently selected and schedules exist,
   * automatically selects first schedule (UX convenience).
   *
   * @returns {Promise<Array<Object>>} All schedules after loading
   */
  async loadAll() {
    this.#schedules = await this.#loadSchedulesCmd.call()

    // Auto-select first schedule if none selected (UX convenience)
    if (this.#schedules.length > 0 && !this.#activeScheduleId) {
      this.#activeScheduleId = this.#schedules[0].id
    }

    return this.#schedules
  }

  /**
   * Selects a schedule by ID.
   *
   * Validation:
   * Returns null if schedule ID not found (defensive programming).
   * Only updates selection state if schedule exists.
   *
   * @param {string} id - Schedule ID to select
   * @returns {Object|null} Selected schedule object, or null if not found
   */
  selectSchedule(id) {
    const schedule = this.#schedules.find((s) => s.id === id)
    if (schedule) {
      this.#activeScheduleId = id
      return schedule
    }
    return null
  }

  /**
   * Creates new schedule with sensible defaults.
   *
   * Default Configuration:
   * - Cron interval (1 * * * *)
   * - 800×480 viewport (TRMNL OG dimensions)
   * - Floyd-Steinberg dithering (best quality)
   * - 4-level grayscale palette (gray-4)
   * - Gamma correction enabled (perceptual accuracy)
   * - PNG format (lossless compression)
   *
   * State Updates:
   * 1. Creates schedule via API
   * 2. Appends to local #schedules array
   * 3. Auto-selects new schedule
   *
   * @returns {Promise<Object>} Created schedule object (includes generated ID)
   */
  async create() {
    const defaultSchedule = {
      name: 'New Schedule',
      cron: '*/10 * * * *',
      dashboard_path: '/home',
      viewport: { width: 800, height: 480 },
      webhook_url: '',
      format: 'png',
      dithering: {
        enabled: true,
        method: 'floyd-steinberg',
        palette: 'gray-4',
        gammaCorrection: true,
        blackLevel: 0,
        whiteLevel: 100,
      },
    }

    const created = await this.#createScheduleCmd.call(defaultSchedule)
    this.#schedules.push(created)
    this.#activeScheduleId = created.id

    return created
  }

  /**
   * Updates existing schedule with partial changes.
   *
   * Optimistic Update Pattern:
   * 1. Sends updates to API
   * 2. Replaces local schedule with API response (authoritative)
   * 3. Returns updated schedule
   *
   * Partial Updates:
   * Only fields in 'updates' object are changed (merge behavior).
   * API handles merging - client just sends delta.
   *
   * State Consistency:
   * Finds schedule by ID and replaces entire object with API response.
   * Preserves array order (in-place replacement via index).
   *
   * @param {string} id - Schedule ID to update
   * @param {Object} updates - Partial schedule object with changed fields
   * @returns {Promise<Object>} Updated schedule object from API
   */
  async update(id, updates) {
    const updated = await this.#updateScheduleCmd.call(id, updates)

    // Replace local copy with authoritative API response
    const index = this.#schedules.findIndex((s) => s.id === id)
    if (index !== -1) {
      this.#schedules[index] = updated
    }

    return updated
  }

  /**
   * Deletes schedule and updates selection state.
   *
   * Selection Recovery:
   * If deleted schedule was active, auto-selects first remaining schedule.
   * Prevents UI entering null state (always has selection if schedules exist).
   *
   * State Updates:
   * 1. Deletes via API
   * 2. Filters out deleted schedule from local array
   * 3. Updates activeScheduleId if necessary
   *
   * Edge Cases:
   * Returns null if no schedules remain after deletion.
   * Selection unchanged if non-active schedule deleted.
   *
   * @param {string} id - Schedule ID to delete
   * @returns {Promise<string|null>} New active schedule ID, or null if none remain
   */
  async delete(id) {
    await this.#deleteScheduleCmd.call(id)

    // Remove from local state
    this.#schedules = this.#schedules.filter((s) => s.id !== id)

    // Update active schedule if we deleted the selected one
    if (this.#activeScheduleId === id) {
      this.#activeScheduleId =
        this.#schedules.length > 0 ? this.#schedules[0].id : null
    }

    return this.#activeScheduleId
  }

  /**
   * Checks if schedule collection is empty.
   * Convenience method for conditional rendering (empty state vs. schedule list).
   * @returns {boolean} True if no schedules exist
   */
  isEmpty() {
    return this.#schedules.length === 0
  }
}
