/**
 * Configuration constants for the TRMNL HA add-on
 * @module const
 */

import { readFileSync, existsSync } from 'fs'

// =============================================================================
// OPTIONS FILE LOADING
// =============================================================================

/**
 * Searches for and loads the first available options file
 * Priority: local dev file first, then add-on data path
 */
const optionsFile = ['./options-dev.json', '/data/options.json'].find(
  existsSync
)

if (!optionsFile) {
  console.error(
    'No options file found. Please copy options-dev.json.sample to options-dev.json'
  )
  process.exit(1)
}

const options = JSON.parse(readFileSync(optionsFile))

// =============================================================================
// ENVIRONMENT DETECTION
// =============================================================================

/**
 * Whether running as Home Assistant add-on (true) or local development (false)
 * @type {boolean}
 */
export const isAddOn = optionsFile === '/data/options.json'

/**
 * Whether to use mock Home Assistant for testing and local development
 * Set MOCK_HA=true environment variable to enable mock mode
 * In mock mode, the app connects to a mock HA server on localhost:8123
 * @type {boolean}
 */
export const useMockHA = process.env.MOCK_HA === 'true'

if (useMockHA) {
  console.log(
    '[Mock] Running in MOCK mode - using mock HA server on localhost:8123'
  )
}

// =============================================================================
// HOME ASSISTANT CONNECTION
// =============================================================================

/**
 * Home Assistant base URL
 * Automatically switches to mock server when MOCK_HA=true
 * @type {string}
 */
export const hassUrl = useMockHA
  ? 'http://localhost:8123' // Mock HA server
  : isAddOn
  ? options.home_assistant_url || 'http://homeassistant:8123'
  : options.home_assistant_url || 'http://localhost:8123'

/**
 * Long-lived access token for Home Assistant authentication
 * Uses mock token when MOCK_HA=true, otherwise reads from options
 * @type {string|undefined}
 */
export const hassToken = useMockHA
  ? 'mock-token-for-testing' // Any token works with mock server
  : options.access_token

if (!hassToken && !useMockHA) {
  console.warn(
    'No access token configured. UI will show configuration instructions.'
  )
}

// =============================================================================
// BROWSER CONFIGURATION
// =============================================================================

/**
 * Path to Chromium/Chrome executable
 * @type {string}
 */
export const chromiumExecutable = isAddOn
  ? '/usr/bin/chromium'
  : options.chromium_executable ||
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

/**
 * Keep browser instance open between requests for performance
 * @type {boolean}
 */
export const keepBrowserOpen = options.keep_browser_open || false

/**
 * Enable debug logging
 * @type {boolean}
 */
export const debug = false

// =============================================================================
// SERVER CONFIGURATION
// =============================================================================

/**
 * HTTP server port
 * @type {number}
 */
export const SERVER_PORT = 10000

/**
 * Browser idle timeout before cleanup (milliseconds)
 * Configurable via BROWSER_TIMEOUT environment variable
 * Default increased from 30s to 60s for better performance under intermittent load
 * @type {number}
 */
export const BROWSER_TIMEOUT = parseInt(process.env.BROWSER_TIMEOUT || '60000')

/**
 * Maximum screenshots before proactive browser restart (memory cleanup)
 * Prevents gradual memory accumulation in long-running sessions (auto-refresh, scheduled jobs)
 * Browser automatically relaunches on next request after cleanup
 * Set to 0 to disable request-based cleanup
 * Configurable via MAX_SCREENSHOTS_BEFORE_RESTART environment variable
 * @type {number}
 */
export const MAX_SCREENSHOTS_BEFORE_RESTART = parseInt(
  process.env.MAX_SCREENSHOTS_BEFORE_RESTART || '100'
)

/**
 * Maximum queued "next" requests to prevent runaway loops
 * @type {number}
 */
export const MAX_NEXT_REQUESTS = 100

// =============================================================================
// SCREENSHOT CONFIGURATION
// =============================================================================

/**
 * Home Assistant header height in pixels (clipped from screenshots)
 * @type {number}
 */
export const HEADER_HEIGHT = 56

/**
 * Valid output image formats
 * @type {string[]}
 */
export const VALID_FORMATS = ['png', 'jpeg', 'bmp']

/**
 * Valid rotation angles in degrees
 * @type {number[]}
 */
export const VALID_ROTATIONS = [90, 180, 270]

/**
 * Color palette definitions for e-ink displays
 * @type {Object.<string, string[]>}
 */
export const COLOR_PALETTES = {
  'color-6a': [
    '#FF0000',
    '#00FF00',
    '#0000FF',
    '#FFFF00',
    '#000000',
    '#FFFFFF',
  ],
  'color-7a': [
    '#000000',
    '#FFFFFF',
    '#FF0000',
    '#00FF00',
    '#0000FF',
    '#FFFF00',
    '#FFA500',
  ],
}

/**
 * Grayscale palette definitions (number of gray levels)
 * @type {Object.<string, number>}
 */
export const GRAYSCALE_PALETTES = {
  bw: 2,
  'gray-4': 4,
  'gray-16': 16,
  'gray-256': 256,
}

/**
 * Default wait time after page load (milliseconds)
 * Add-on uses longer time due to slower environment
 * @type {number}
 */
export const DEFAULT_WAIT_TIME = isAddOn ? 750 : 500

/**
 * Extra wait time on cold start for icons/images to load (milliseconds)
 * @type {number}
 */
export const COLD_START_EXTRA_WAIT = 2500

/**
 * Content-Type headers for each output format
 * @type {Object.<string, string>}
 */
export const CONTENT_TYPES = {
  jpeg: 'image/jpeg',
  bmp: 'image/bmp',
  png: 'image/png',
}

// =============================================================================
// SCHEDULER CONFIGURATION
// =============================================================================

/**
 * Scheduler log prefix for console output
 * @type {string}
 */
export const SCHEDULER_LOG_PREFIX = '[Scheduler]'

/**
 * Schedule reload interval in milliseconds
 * @type {number}
 */
export const SCHEDULER_RELOAD_INTERVAL_MS = 60000 // 1 minute

/**
 * Maximum retry attempts for failed schedules
 * @type {number}
 */
export const SCHEDULER_MAX_RETRIES = 3

/**
 * Delay between retry attempts in milliseconds
 * @type {number}
 */
export const SCHEDULER_RETRY_DELAY_MS = 5000 // 5 seconds

/**
 * Retention multiplier for screenshot files
 * Keep N times the number of enabled schedules
 * @type {number}
 */
export const SCHEDULER_RETENTION_MULTIPLIER = 2

/**
 * Regular expression pattern for image file extensions
 * @type {RegExp}
 */
export const SCHEDULER_IMAGE_FILE_PATTERN = /\.(png|jpeg|jpg|bmp)$/i

/**
 * Output directory name for scheduler screenshots
 * @type {string}
 */
export const SCHEDULER_OUTPUT_DIR_NAME = 'output'

/**
 * Maximum length for truncating response bodies in logs
 * @type {number}
 */
export const SCHEDULER_RESPONSE_BODY_TRUNCATE_LENGTH = 200

/**
 * Network error detection patterns
 * @type {string[]}
 */
export const SCHEDULER_NETWORK_ERROR_PATTERNS = [
  'Network error',
  'ERR_NAME_NOT_RESOLVED',
  'ERR_CONNECTION_REFUSED',
  'ERR_INTERNET_DISCONNECTED',
]

/**
 * Check if error is a network error
 * @param {Error} error - The error to check
 * @returns {boolean}
 */
export function isSchedulerNetworkError(error) {
  return SCHEDULER_NETWORK_ERROR_PATTERNS.some((pattern) =>
    error.message?.includes(pattern)
  )
}
