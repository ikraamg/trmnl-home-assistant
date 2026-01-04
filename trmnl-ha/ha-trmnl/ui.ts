/**
 * Web UI request handler for the TRMNL HA add-on
 * Serves the configuration interface and error pages
 *
 * @module ui
 */

import type { ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  createConnection,
  createLongLivedTokenAuth,
} from 'home-assistant-js-websocket'
import type { HassConfig, Connection } from 'home-assistant-js-websocket'
import { hassUrl, hassToken } from './const.js'
import { loadPresets } from './devices.js'
import type { PresetsConfig } from './types/domain.js'
import { uiLogger } from './lib/logger.js'

const log = uiLogger()

// =============================================================================
// CONSTANTS
// =============================================================================

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const HTML_DIR = join(__dirname, 'html')

// =============================================================================
// TYPES
// =============================================================================

/** Theme data from Home Assistant */
interface ThemesResult {
  themes: Record<string, Record<string, string>>
  default_theme: string
}

/** Network URL data from Home Assistant */
interface NetworkResult {
  external_url: string | null
  internal_url: string | null
}

/** Dashboard info from Home Assistant */
interface DashboardInfo {
  url_path: string
  title?: string
  mode?: string
}

/** Combined Home Assistant data for UI */
interface HomeAssistantData {
  themes: ThemesResult | null
  network: NetworkResult | null
  config: HassConfig | null
  dashboards: string[] | null
  presets?: PresetsConfig
}

/** UI configuration passed to frontend */
interface UIConfig {
  hasToken: boolean
  hassUrl: string
  /** Whether HA connection succeeded (themes/dashboards available) */
  haConnected: boolean
  /** First 4 chars of token masked (e.g., "eyJ1****") for debugging */
  tokenPreview: string | null
  /** Human-readable connection status reason */
  connectionStatus: string
  /** Timestamp when HA data was last fetched (for cache age display) */
  cachedAt: number | null
}

// =============================================================================
// HA DATA CACHE
// =============================================================================

/** Cached HA data to avoid blocking every UI request */
let cachedHassData: HomeAssistantData | null = null

/** Timestamp when cache was last populated */
let cacheTimestamp: number = 0

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Sends an HTML response with proper headers
 */
function sendHtmlResponse(
  response: ServerResponse,
  html: string,
  statusCode: number = 200
): void {
  response.writeHead(statusCode, {
    'Content-Type': 'text/html',
    'Content-Length': Buffer.byteLength(html),
  })
  response.end(html)
}

// =============================================================================
// HOME ASSISTANT DATA FETCHING
// =============================================================================

/** Timeout for HA connection attempts (5 seconds) */
const HA_CONNECTION_TIMEOUT = 5000

/**
 * Wraps a promise with a timeout
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(message)), ms)
    ),
  ])
}

/**
 * Fetches configuration data from Home Assistant via WebSocket and REST API
 */
async function fetchHomeAssistantData(): Promise<HomeAssistantData> {
  try {
    log.debug`Connecting to HA at: ${hassUrl}`
    log.debug`Token configured: ${
      hassToken ? 'yes (' + hassToken.substring(0, 10) + '...)' : 'NO'
    }`

    const auth = createLongLivedTokenAuth(hassUrl, hassToken!)
    const connection: Connection = await withTimeout(
      createConnection({ auth }),
      HA_CONNECTION_TIMEOUT,
      `HA connection timeout after ${HA_CONNECTION_TIMEOUT}ms`
    )

    const [themesResult, networkResult, dashboardsResult] = await Promise.all([
      connection.sendMessagePromise<ThemesResult>({
        type: 'frontend/get_themes',
      }),
      connection.sendMessagePromise<NetworkResult>({ type: 'network/url' }),
      connection
        .sendMessagePromise<DashboardInfo[]>({
          type: 'lovelace/dashboards/list',
        })
        .catch(() => null),
    ])

    connection.close()

    const configResponse = await fetch(`${hassUrl}/api/config`, {
      headers: {
        Authorization: `Bearer ${hassToken}`,
        'Content-Type': 'application/json',
      },
    })

    const config: HassConfig | null = configResponse.ok
      ? ((await configResponse.json()) as HassConfig)
      : null

    let dashboards = [
      '/lovelace/0',
      '/home',
      '/map',
      '/energy',
      '/history',
      '/logbook',
      '/config',
    ]

    try {
      if (dashboardsResult && Array.isArray(dashboardsResult)) {
        dashboardsResult.forEach((d) => {
          if (d.url_path) {
            dashboards.push(`/lovelace/${d.url_path}`)
            dashboards.push(`/${d.url_path}`)
            dashboards.push(`/${d.url_path}/0`)
            dashboards.push(`/lovelace/${d.url_path}/0`)
          }
        })
        dashboards = [...new Set(dashboards)]
      }
    } catch (err) {
      log.warn`Could not parse dashboards, using defaults: ${
        (err as Error).message
      }`
    }

    return { themes: themesResult, network: networkResult, config, dashboards }
  } catch (err) {
    log.error`Error fetching HA data: ${(err as Error).message || err}`
    const error = err as Error & { code?: string; cause?: unknown }
    if (error.code) log.debug`Error code: ${error.code}`
    if (error.cause) log.debug`Error cause: ${error.cause}`
    return { themes: null, network: null, config: null, dashboards: null }
  }
}

/**
 * Gets HA data from cache or fetches fresh data.
 * Cache is used unless forceRefresh is true.
 */
async function getCachedOrFetch(forceRefresh: boolean): Promise<{
  data: HomeAssistantData
  cachedAt: number
}> {
  // Return cached data if available and not forcing refresh
  if (cachedHassData && !forceRefresh) {
    log.debug`Using cached HA data (age: ${Math.round((Date.now() - cacheTimestamp) / 1000)}s)`
    return { data: cachedHassData, cachedAt: cacheTimestamp }
  }

  // Fetch fresh data
  log.info`Fetching fresh HA data${forceRefresh ? ' (forced refresh)' : ''}`
  const data = await fetchHomeAssistantData()
  cachedHassData = data
  cacheTimestamp = Date.now()
  return { data, cachedAt: cacheTimestamp }
}

// =============================================================================
// MAIN UI HANDLER
// =============================================================================

/**
 * Handles requests for the web UI
 *
 * Always serves the main UI - no blocking error pages.
 * Connection status is passed to frontend for inline messaging.
 * HA data is cached to avoid blocking on every request.
 *
 * @param response - HTTP response object
 * @param requestUrl - Request URL to check for ?refresh=1 query param
 */
export async function handleUIRequest(
  response: ServerResponse,
  requestUrl?: URL
): Promise<void> {
  try {
    // Check for forced refresh via query param
    const forceRefresh = requestUrl?.searchParams.get('refresh') === '1'

    // Attempt HA connection if token is configured (using cache)
    let hassData: HomeAssistantData = {
      themes: null,
      network: null,
      config: null,
      dashboards: null,
    }
    let cachedAt: number | null = null

    if (hassToken) {
      const result = await getCachedOrFetch(forceRefresh)
      hassData = result.data
      cachedAt = result.cachedAt
    }

    // Determine if HA connection succeeded
    const haConnected = !!(hassData.themes && hassData.config)

    // Build token preview (first 4 chars masked)
    const tokenPreview = hassToken
      ? `${hassToken.slice(0, 4)}****`
      : null

    // Determine connection status reason
    let connectionStatus: string
    if (haConnected) {
      connectionStatus = 'Connected'
    } else if (!hassToken) {
      connectionStatus = 'No token configured'
    } else if (!hassData.themes && !hassData.config) {
      connectionStatus = 'Connection failed - could not reach HA'
    } else if (!hassData.themes) {
      connectionStatus = 'Connected but themes unavailable'
    } else {
      connectionStatus = 'Connected but config unavailable'
    }

    // Log connection status for debugging
    if (haConnected) {
      log.info`HA connection: ${connectionStatus} | URL: ${hassUrl} | Token: ${tokenPreview}`
    } else {
      log.warning`HA connection: ${connectionStatus} | URL: ${hassUrl} | Token: ${tokenPreview ?? 'not set'}`
    }

    // Build UI config for frontend
    const uiConfig: UIConfig = {
      hasToken: !!hassToken,
      hassUrl,
      haConnected,
      tokenPreview,
      connectionStatus,
      cachedAt,
    }

    const htmlPath = join(HTML_DIR, 'index.html')
    let html = await readFile(htmlPath, 'utf-8')

    const presets = loadPresets()
    const hassDataWithDevices: HomeAssistantData & { presets: PresetsConfig } =
      {
        ...hassData,
        presets,
      }

    // Inject both HA data and UI config into the page
    const scriptTag = `<script>
window.hass = ${JSON.stringify(hassDataWithDevices, null, 2)};
window.uiConfig = ${JSON.stringify(uiConfig)};
</script>`
    html = html.replace('</head>', `${scriptTag}\n  </head>`)

    sendHtmlResponse(response, html)
  } catch (err) {
    log.error`Error serving UI: ${err}`
    response.statusCode = 500
    response.end('Error loading UI')
  }
}
