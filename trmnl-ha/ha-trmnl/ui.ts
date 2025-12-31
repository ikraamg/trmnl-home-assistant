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
import { hassUrl, hassToken, isAddOn } from './const.js'
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
const CONFIG_FILE = isAddOn ? '/data/options.json' : 'options-dev.json'

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

/**
 * Generates HTML instructions for configuring access token
 */
function generateConfigInstructions(action: 'Configure' | 'Update'): string {
  if (isAddOn) {
    return `
      <li>
        <strong>${action} the Add-on Configuration:</strong>
        <ul class="ml-6 mt-2 space-y-1 list-disc list-inside text-sm">
          <li>Go to Settings → Add-ons</li>
          <li>Click on the TRMNL HA add-on</li>
          <li>Go to the Configuration tab</li>
          <li>${
            action === 'Configure' ? 'Paste' : 'Update'
          } your token in the "access_token" field</li>
          <li>Save and restart the add-on</li>
        </ul>
      </li>`
  }

  return `
      <li>
        <strong>${
          action === 'Configure' ? 'Add to' : 'Update'
        } Configuration File:</strong>
        <ul class="ml-6 mt-2 space-y-1 list-disc list-inside text-sm">
          <li>Open the file: <code class="bg-gray-100 px-2 py-1 rounded">${CONFIG_FILE}</code></li>
          <li>${
            action === 'Configure' ? 'Add or update' : 'Update'
          } the <code class="bg-gray-100 px-2 py-1 rounded">access_token</code> field with your token</li>
          <li>Save the file and restart the service</li>
        </ul>
      </li>`
}

// =============================================================================
// HOME ASSISTANT DATA FETCHING
// =============================================================================

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
    const connection: Connection = await createConnection({ auth })

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

// =============================================================================
// ERROR PAGE HANDLERS
// =============================================================================

/**
 * Serves the missing configuration error page
 */
async function serveMissingConfigPage(response: ServerResponse): Promise<void> {
  const htmlPath = join(HTML_DIR, 'error_missing_config.html')
  let html = await readFile(htmlPath, 'utf-8')

  html = html.replace(
    '{{CONFIG_INSTRUCTIONS}}',
    generateConfigInstructions('Configure')
  )
  html = html.replace('{{HASS_URL}}', hassUrl)

  sendHtmlResponse(response, html)
}

/**
 * Serves the connection failed error page
 */
async function serveConnectionFailedPage(
  response: ServerResponse
): Promise<void> {
  const htmlPath = join(HTML_DIR, 'error_connection_failed.html')
  let html = await readFile(htmlPath, 'utf-8')

  html = html.replace(
    '{{CONFIG_INSTRUCTIONS}}',
    generateConfigInstructions('Update')
  )
  html = html.replace(/{{HASS_URL}}/g, hassUrl)
  html = html.replace('{{TOKEN_LENGTH}}', String(hassToken?.length || 0))

  sendHtmlResponse(response, html)
}

// =============================================================================
// MAIN UI HANDLER
// =============================================================================

/**
 * Handles requests for the web UI
 */
export async function handleUIRequest(response: ServerResponse): Promise<void> {
  try {
    if (!hassToken) {
      await serveMissingConfigPage(response)
      return
    }

    const hassData = await fetchHomeAssistantData()

    if (!hassData.themes || !hassData.network || !hassData.config) {
      await serveConnectionFailedPage(response)
      return
    }

    const htmlPath = join(HTML_DIR, 'index.html')
    let html = await readFile(htmlPath, 'utf-8')

    const presets = loadPresets()
    const hassDataWithDevices: HomeAssistantData & { presets: PresetsConfig } =
      {
        ...hassData,
        presets,
      }

    const scriptTag = `<script>window.hass = ${JSON.stringify(
      hassDataWithDevices,
      null,
      2
    )};</script>`
    html = html.replace('</head>', `${scriptTag}\n  </head>`)

    sendHtmlResponse(response, html)
  } catch (err) {
    log.error`Error serving UI: ${err}`
    response.statusCode = 500
    response.end('Error loading UI')
  }
}
