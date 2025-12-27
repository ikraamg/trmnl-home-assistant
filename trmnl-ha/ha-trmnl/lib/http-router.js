/**
 * HTTP Router Module
 *
 * Maps incoming HTTP requests to appropriate handlers for:
 * - UI endpoints (root page at /)
 * - API endpoints (schedules, devices, presets CRUD)
 * - Health checks (/health)
 * - Static file serving (JS, CSS, images)
 *
 * Architecture:
 * - Route precedence: More specific routes checked before generic ones
 * - RESTful API design: GET/POST/PUT/DELETE methods on resource URLs
 * - Two-phase initialization: Scheduler injected after construction
 *
 * Security:
 * - Path joining uses node:path to prevent directory traversal
 * - Static files limited to HTML_DIR (html/ subdirectory)
 * - No authentication (prototype stage - trusted networks only)
 *
 * @module lib/http-router
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { handleUIRequest } from '../ui.js'
import {
  loadSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
} from './scheduleStore.js'
import { loadDevicesConfig, loadPresets } from '../devices.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const HTML_DIR = join(__dirname, '..', 'html')

/**
 * Helper command for reading HTTP request bodies.
 *
 * Streams request body chunks into a string using event listeners.
 * Used for POST/PUT requests with JSON payloads.
 *
 * @class
 * @private
 */
class ReadRequestBody {
  /**
   * Reads the full request body as a string.
   *
   * @param {http.IncomingMessage} request - HTTP request stream
   * @returns {Promise<string>} Full request body as string
   */
  async call(request) {
    return new Promise((resolve, reject) => {
      let body = ''
      request.on('data', (chunk) => {
        body += chunk.toString()
      })
      request.on('end', () => {
        resolve(body)
      })
      request.on('error', reject)
    })
  }
}

/**
 * HTTP router dispatching requests to handlers based on URL paths and methods.
 *
 * Responsibilities:
 * - Route matching with precedence (specific before generic)
 * - RESTful API implementation for schedules, devices, presets
 * - Static file serving with MIME type detection
 * - Health check endpoint with browser status
 * - Manual schedule execution API
 *
 * Route Precedence:
 * More specific routes MUST be checked before generic ones:
 * - /api/schedules/:id/send (specific) before /api/schedules/:id (generic)
 * This prevents "/send" being treated as an ID.
 *
 * Two-Phase Initialization:
 * Scheduler is optional in constructor but required for /api/schedules/:id/send endpoint.
 * Main.js injects scheduler after construction via setScheduler() to break circular dependency.
 *
 * NOTE: Returns boolean from route() to indicate if route was handled - caller falls back
 * to screenshot handler if false.
 * AI: When adding routes, maintain precedence order (specific before generic).
 *
 * @class
 */
export class HttpRouter {
  #readBodyCmd
  #healthMonitor
  #recoveryManager
  #scheduler

  /**
   * Creates HTTP router instance.
   *
   * @param {BrowserHealthMonitor} healthMonitor - Browser health tracker
   * @param {BrowserRecoveryManager} recoveryManager - Browser recovery coordinator
   * @param {Scheduler} [scheduler=null] - Scheduler instance (optional, set later via setScheduler)
   */
  constructor(healthMonitor, recoveryManager, scheduler = null) {
    this.#readBodyCmd = new ReadRequestBody()
    this.#healthMonitor = healthMonitor
    this.#recoveryManager = recoveryManager
    this.#scheduler = scheduler
  }

  /**
   * Sets the scheduler instance (called after construction)
   * @param {Scheduler} scheduler - Scheduler instance for manual execution
   */
  setScheduler(scheduler) {
    this.#scheduler = scheduler
  }

  /**
   * Routes incoming HTTP request to appropriate handler.
   *
   * Route Matching Order (precedence matters):
   * 1. /health - Health check endpoint
   * 2. /favicon.ico - Favicon (404 response)
   * 3. / - UI root page
   * 4. /api/schedules - Schedule list/creation
   * 5. /api/schedules/:id/send - Manual execution (specific before generic!)
   * 6. /api/schedules/:id - Schedule update/deletion
   * 7. /api/devices - Device configurations
   * 8. /api/presets - Device presets
   * 9. /js/* and /css/* - Static files
   * 10. (fallback) - Caller handles unmatched routes (screenshot requests)
   *
   * NOTE: Specific routes like /send MUST be checked before generic ID routes
   * to prevent "/send" being extracted as the ID.
   *
   * @param {http.IncomingMessage} request - HTTP request object
   * @param {http.ServerResponse} response - HTTP response object
   * @param {URL} requestUrl - Parsed URL object
   * @returns {Promise<boolean>} True if route was handled, false if caller should handle
   */
  async route(request, response, requestUrl) {
    const { pathname } = requestUrl

    // Health check endpoint
    if (pathname === '/health') {
      return this.#handleHealth(response)
    }

    // Favicon (not provided - return 404)
    if (pathname === '/favicon.ico') {
      response.statusCode = 404
      response.end()
      return true
    }

    // UI root
    if (pathname === '/') {
      await handleUIRequest(response)
      return true
    }

    // API: Schedule collection
    if (pathname === '/api/schedules') {
      return this.#handleSchedulesAPI(request, response)
    }

    // API: Schedule-specific routes
    if (pathname.startsWith('/api/schedules/')) {
      // NOTE: Check /send endpoint first (more specific) before generic ID handler
      if (pathname.endsWith('/send')) {
        return this.#handleScheduleSendAPI(request, response, requestUrl)
      }
      return this.#handleScheduleAPI(request, response, requestUrl)
    }

    // API: Devices and presets
    if (pathname === '/api/devices') {
      return this.#handleDevicesAPI(response)
    }

    if (pathname === '/api/presets') {
      return this.#handlePresetsAPI(response)
    }

    // Static files (JS, CSS, images, etc.)
    if (pathname.startsWith('/js/') || pathname.startsWith('/css/')) {
      return this.#handleStaticFile(response, pathname)
    }

    // Not a recognized route - caller should handle (screenshot request)
    return false
  }

  /**
   * Health check endpoint handler (GET /health).
   *
   * Returns JSON with system status:
   * - HTTP 200 if browser is healthy
   * - HTTP 503 if browser is degraded (failed health check)
   *
   * Response includes browser health metrics and recovery statistics.
   *
   * @private
   * @param {http.ServerResponse} response - HTTP response object
   * @returns {boolean} True (route handled)
   */
  #handleHealth(response) {
    const browserHealth = this.#healthMonitor.checkHealth()
    const recoveryStats = this.#recoveryManager.getStats()

    const status = browserHealth.healthy ? 'ok' : 'degraded'
    const httpStatus = browserHealth.healthy ? 200 : 503

    response.writeHead(httpStatus, { 'Content-Type': 'application/json' })
    response.end(
      JSON.stringify({
        status,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        browser: {
          ...browserHealth,
          ...recoveryStats,
        },
      })
    )

    return true
  }

  /**
   * Schedules collection endpoint handler.
   *
   * Supported methods:
   * - GET: List all schedules (200 OK)
   * - POST: Create new schedule (201 Created or 400 Bad Request)
   *
   * @private
   * @param {http.IncomingMessage} request - HTTP request object
   * @param {http.ServerResponse} response - HTTP response object
   * @returns {Promise<boolean>} True (route handled)
   */
  async #handleSchedulesAPI(request, response) {
    response.setHeader('Content-Type', 'application/json')

    if (request.method === 'GET') {
      const schedules = loadSchedules()
      response.writeHead(200)
      response.end(JSON.stringify(schedules))
      return true
    }

    if (request.method === 'POST') {
      try {
        const body = await this.#readBodyCmd.call(request)
        const schedule = JSON.parse(body)
        const created = createSchedule(schedule)
        response.writeHead(201)
        response.end(JSON.stringify(created))
      } catch (err) {
        response.writeHead(400)
        response.end(JSON.stringify({ error: err.message }))
      }
      return true
    }

    response.writeHead(405)
    response.end(JSON.stringify({ error: 'Method not allowed' }))
    return true
  }

  /**
   * Single schedule endpoint handler (GET/PUT/DELETE /api/schedules/:id).
   *
   * Extracts schedule ID from URL path and delegates to scheduleStore.
   *
   * Supported methods:
   * - PUT: Update schedule (200 OK or 404 Not Found or 400 Bad Request)
   * - DELETE: Delete schedule (200 OK or 404 Not Found)
   *
   * @private
   * @param {http.IncomingMessage} request - HTTP request object
   * @param {http.ServerResponse} response - HTTP response object
   * @param {URL} requestUrl - Parsed URL (for extracting ID)
   * @returns {Promise<boolean>} True (route handled)
   */
  async #handleScheduleAPI(request, response, requestUrl) {
    response.setHeader('Content-Type', 'application/json')

    const id = requestUrl.pathname.split('/').pop()

    if (request.method === 'PUT') {
      try {
        const body = await this.#readBodyCmd.call(request)
        const updates = JSON.parse(body)
        const updated = updateSchedule(id, updates)

        if (!updated) {
          response.writeHead(404)
          response.end(JSON.stringify({ error: 'Schedule not found' }))
          return true
        }

        response.writeHead(200)
        response.end(JSON.stringify(updated))
      } catch (err) {
        response.writeHead(400)
        response.end(JSON.stringify({ error: err.message }))
      }
      return true
    }

    if (request.method === 'DELETE') {
      const deleted = deleteSchedule(id)

      if (!deleted) {
        response.writeHead(404)
        response.end(JSON.stringify({ error: 'Schedule not found' }))
        return true
      }

      response.writeHead(200)
      response.end(JSON.stringify({ success: true }))
      return true
    }

    response.writeHead(405)
    response.end(JSON.stringify({ error: 'Method not allowed' }))
    return true
  }

  /**
   * Manual schedule execution endpoint (POST /api/schedules/:id/send).
   *
   * Triggers immediate execution of a schedule outside its cron schedule.
   * Used by the UI "Send Now" button to test webhooks.
   *
   * ID Extraction:
   * Path is /api/schedules/{id}/send, so ID is second-to-last path segment.
   * Cannot use .pop() since that would return "send".
   *
   * Error Handling:
   * - 405 if not POST method
   * - 503 if scheduler not initialized (should not happen after startup)
   * - 404 if schedule ID not found
   * - 500 for other errors (browser crashes, network failures, etc.)
   *
   * NOTE: Error status code determined by substring match on error message - brittle pattern.
   * AI: Consider using custom error types instead of message substring matching.
   *
   * @private
   * @param {http.IncomingMessage} request - HTTP request object
   * @param {http.ServerResponse} response - HTTP response object
   * @param {URL} requestUrl - Parsed URL (for extracting ID)
   * @returns {Promise<boolean>} True (route handled)
   */
  async #handleScheduleSendAPI(request, response, requestUrl) {
    response.setHeader('Content-Type', 'application/json')

    if (request.method !== 'POST') {
      response.writeHead(405)
      response.end(JSON.stringify({ error: 'Method not allowed' }))
      return true
    }

    if (!this.#scheduler) {
      response.writeHead(503)
      response.end(JSON.stringify({ error: 'Scheduler not available' }))
      return true
    }

    // Extract schedule ID from path: /api/schedules/{id}/send
    const pathParts = requestUrl.pathname.split('/')
    const id = pathParts[pathParts.length - 2] // Second to last part (last is "send")

    try {
      const result = await this.#scheduler.executeNow(id)
      response.writeHead(200)
      response.end(JSON.stringify({ success: true, ...result }))
    } catch (err) {
      console.error('Error executing schedule manually:', err)
      // NOTE: Error status determined by message substring - brittle pattern
      response.writeHead(err.message.includes('not found') ? 404 : 500)
      response.end(JSON.stringify({ error: err.message }))
    }

    return true
  }

  /**
   * Devices endpoint handler (GET /api/devices).
   *
   * Returns list of TRMNL device configurations from devices.json.
   *
   * @private
   * @param {http.ServerResponse} response - HTTP response object
   * @returns {boolean} True (route handled)
   */
  #handleDevicesAPI(response) {
    const devices = loadDevicesConfig()
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(devices))
    return true
  }

  /**
   * Presets endpoint handler (GET /api/presets).
   *
   * Returns list of device presets (viewport + rotation + format combos).
   *
   * @private
   * @param {http.ServerResponse} response - HTTP response object
   * @returns {boolean} True (route handled)
   */
  #handlePresetsAPI(response) {
    const presets = loadPresets()
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(presets))
    return true
  }

  /**
   * Static file handler for frontend assets (JS, CSS, images).
   *
   * Security:
   * - Uses node:path join() to prevent directory traversal attacks
   * - Restricts all paths to HTML_DIR (html/ subdirectory)
   * - Returns 404 for any file read errors (not found, permission denied, etc.)
   *
   * MIME Type Detection:
   * Maps file extensions to Content-Type headers for proper browser rendering.
   * Falls back to text/plain for unknown extensions.
   *
   * NOTE: join() normalizes paths and prevents "../" escaping HTML_DIR.
   *
   * @private
   * @param {http.ServerResponse} response - HTTP response object
   * @param {string} pathname - URL pathname (e.g., "/js/app.js")
   * @returns {Promise<boolean>} True (route handled)
   */
  async #handleStaticFile(response, pathname) {
    try {
      // Map URL path to file system path (join() prevents directory traversal)
      const filePath = join(HTML_DIR, pathname)

      // Read file
      const content = await readFile(filePath)

      // Determine MIME type from extension
      const ext = pathname.split('.').pop()
      const mimeTypes = {
        js: 'application/javascript',
        css: 'text/css',
        json: 'application/json',
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        svg: 'image/svg+xml',
        ico: 'image/x-icon',
      }
      const contentType = mimeTypes[ext] || 'text/plain'

      // Send response
      response.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': content.length,
      })
      response.end(content)
      return true
    } catch (_err) {
      // File not found or other error (permissions, etc.)
      response.statusCode = 404
      response.end('Not Found')
      return true
    }
  }
}
