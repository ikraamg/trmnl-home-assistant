/**
 * API Client Module
 *
 * Thin wrappers around fetch() API for backend communication.
 * Each class represents one API operation following Command Pattern.
 *
 * Design Pattern:
 * Command Pattern - each class encapsulates single API request.
 * Consistent interface: constructor(baseUrl), async call(...args).
 * Enables easy testing (inject mock baseUrl), dependency injection.
 *
 * Error Handling:
 * HTTP errors (4xx, 5xx) throw Error with status text.
 * Network errors (DNS, timeout) bubble up from fetch().
 * Caller responsible for try/catch and user-facing error messages.
 *
 * API Endpoints:
 * - GET /api/schedules - List all schedules
 * - POST /api/schedules - Create new schedule
 * - PUT /api/schedules/:id - Update schedule
 * - DELETE /api/schedules/:id - Delete schedule
 * - GET /api/devices - List device configurations
 * - GET /api/presets - List device presets
 *
 * Usage Pattern:
 * ```js
 * const loader = new LoadSchedules()
 * const schedules = await loader.call()
 * ```
 *
 * Why Classes Not Functions?:
 * Enables dependency injection (baseUrl) and easier mocking for tests.
 * Consistent .call() interface mirrors backend command pattern.
 *
 * NOTE: All commands are stateless - safe to create new instance per call.
 * AI: When adding endpoints, follow same command class pattern for consistency.
 *
 * @module html/js/api-client
 */

/**
 * Fetches all schedules from the API
 */
export class LoadSchedules {
  constructor(baseUrl = './api/schedules') {
    this.baseUrl = baseUrl
  }

  async call() {
    const response = await fetch(this.baseUrl)
    if (!response.ok) {
      throw new Error(`Failed to load schedules: ${response.statusText}`)
    }
    return response.json()
  }
}

/**
 * Creates a new schedule
 */
export class CreateSchedule {
  constructor(baseUrl = './api/schedules') {
    this.baseUrl = baseUrl
  }

  async call(schedule) {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(schedule),
    })

    if (!response.ok) {
      throw new Error(`Failed to create schedule: ${response.statusText}`)
    }

    return response.json()
  }
}

/**
 * Updates an existing schedule
 */
export class UpdateSchedule {
  constructor(baseUrl = './api/schedules') {
    this.baseUrl = baseUrl
  }

  async call(id, updates) {
    const response = await fetch(`${this.baseUrl}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })

    if (!response.ok) {
      throw new Error(`Failed to update schedule: ${response.statusText}`)
    }

    return response.json()
  }
}

/**
 * Deletes a schedule
 */
export class DeleteSchedule {
  constructor(baseUrl = './api/schedules') {
    this.baseUrl = baseUrl
  }

  async call(id) {
    const response = await fetch(`${this.baseUrl}/${id}`, {
      method: 'DELETE',
    })

    if (!response.ok) {
      throw new Error(`Failed to delete schedule: ${response.statusText}`)
    }

    return response.json()
  }
}

/**
 * Loads device configurations
 */
export class LoadDevices {
  constructor(baseUrl = './api/devices') {
    this.baseUrl = baseUrl
  }

  async call() {
    const response = await fetch(this.baseUrl)
    if (!response.ok) {
      throw new Error(`Failed to load devices: ${response.statusText}`)
    }
    return response.json()
  }
}

/**
 * Loads device presets
 */
export class LoadPresets {
  constructor(baseUrl = './api/presets') {
    this.baseUrl = baseUrl
  }

  async call() {
    const response = await fetch(this.baseUrl)
    if (!response.ok) {
      throw new Error(`Failed to load presets: ${response.statusText}`)
    }
    return response.json()
  }
}

/**
 * Fetches a screenshot preview
 */
export class FetchPreview {
  constructor() {
    // No base URL needed - uses schedule path directly
  }

  /**
   * Fetches preview image for a schedule
   * @param {string} path - Dashboard path
   * @param {URLSearchParams} params - Query parameters
   * @returns {Promise<Blob>} Image blob
   */
  async call(path, params) {
    const url = `.${path}?${params.toString()}`
    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    return response.blob()
  }
}
