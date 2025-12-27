/**
 * Web UI request handler for the TRMNL HA add-on
 * Serves the configuration interface and error pages
 * @module ui
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createConnection, createLongLivedTokenAuth } from "home-assistant-js-websocket";
import { hassUrl, hassToken, isAddOn } from "./const.js";
import { loadDevicesConfig } from "./devices.js";

// =============================================================================
// CONSTANTS
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** @type {string} Path to HTML templates directory */
const HTML_DIR = join(__dirname, "html");

/** @type {string} Path to config file based on environment */
const CONFIG_FILE = isAddOn ? "/data/options.json" : "options-dev.json";

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Sends an HTML response with proper headers
 * @param {http.ServerResponse} response - HTTP response object
 * @param {string} html - HTML content to send
 * @param {number} [statusCode=200] - HTTP status code
 */
function sendHtmlResponse(response, html, statusCode = 200) {
  response.writeHead(statusCode, {
    "Content-Type": "text/html",
    "Content-Length": Buffer.byteLength(html)
  });
  response.end(html);
}

/**
 * Generates HTML instructions for configuring access token
 * Different instructions for add-on vs local development
 * @param {string} action - Action verb ("Configure" or "Update")
 * @returns {string} HTML list item with instructions
 */
function generateConfigInstructions(action) {
  if (isAddOn) {
    return `
      <li>
        <strong>${action} the Add-on Configuration:</strong>
        <ul class="ml-6 mt-2 space-y-1 list-disc list-inside text-sm">
          <li>Go to Settings → Add-ons</li>
          <li>Click on the TRMNL HA add-on</li>
          <li>Go to the Configuration tab</li>
          <li>${action === "Configure" ? "Paste" : "Update"} your token in the "access_token" field</li>
          <li>Save and restart the add-on</li>
        </ul>
      </li>`;
  }

  return `
      <li>
        <strong>${action === "Configure" ? "Add to" : "Update"} Configuration File:</strong>
        <ul class="ml-6 mt-2 space-y-1 list-disc list-inside text-sm">
          <li>Open the file: <code class="bg-gray-100 px-2 py-1 rounded">${CONFIG_FILE}</code></li>
          <li>${action === "Configure" ? "Add or update" : "Update"} the <code class="bg-gray-100 px-2 py-1 rounded">access_token</code> field with your token</li>
          <li>Save the file and restart the service</li>
        </ul>
      </li>`;
}

// =============================================================================
// HOME ASSISTANT DATA FETCHING
// =============================================================================

/**
 * Fetches configuration data from Home Assistant via WebSocket and REST API
 * @returns {Promise<{themes: Object|null, network: Object|null, config: Object|null, dashboards: Array<string>|null}>}
 *          Home Assistant data or null values on failure
 */
async function fetchHomeAssistantData() {
  try {
    console.log(`[DEBUG] Connecting to HA at: ${hassUrl}`);
    console.log(`[DEBUG] Token configured: ${hassToken ? 'yes (' + hassToken.substring(0, 10) + '...)' : 'NO'}`);

    const auth = createLongLivedTokenAuth(hassUrl, hassToken);
    const connection = await createConnection({ auth });

    // Fetch themes, network URLs, and dashboards in parallel via WebSocket
    const [themesResult, networkResult, dashboardsResult] = await Promise.all([
      connection.sendMessagePromise({ type: "frontend/get_themes" }),
      connection.sendMessagePromise({ type: "network/url" }),
      connection.sendMessagePromise({ type: "lovelace/dashboards/list" }).catch(() => null)
    ]);

    connection.close();

    // Fetch system config via REST API (contains language setting)
    const configResponse = await fetch(`${hassUrl}/api/config`, {
      headers: {
        Authorization: `Bearer ${hassToken}`,
        "Content-Type": "application/json"
      }
    });

    const config = configResponse.ok ? await configResponse.json() : null;

    // Extract dashboard paths from WebSocket response
    // HA supports multiple URL formats for dashboards:
    // - /lovelace/{url_path} = Custom Lovelace dashboards
    // - /{url_path} = Built-in dashboards (map, energy, history, etc.)
    // - /{url_path}/0 = Built-in dashboards with tab index
    // - /lovelace/{url_path}/0 = Custom dashboards with tab index (some setups)
    let dashboards = [
      "/lovelace/0",  // Default dashboard
      "/home",        // Home view
      "/map",         // Built-in map dashboard
      "/energy",      // Built-in energy dashboard
      "/history",     // Built-in history
      "/logbook",     // Built-in logbook
      "/config"       // Configuration
    ];

    try {
      if (dashboardsResult && Array.isArray(dashboardsResult)) {
        dashboardsResult.forEach(d => {
          if (d.url_path) {
            // Add all possible URL format variations
            dashboards.push(`/lovelace/${d.url_path}`);      // Lovelace custom dashboard
            dashboards.push(`/${d.url_path}`);               // Built-in dashboard format
            dashboards.push(`/${d.url_path}/0`);             // Built-in with tab index
            dashboards.push(`/lovelace/${d.url_path}/0`);    // Lovelace with tab index
          }
        });
        dashboards = [...new Set(dashboards)]; // Deduplicate
      }
    } catch (err) {
      console.warn("Could not parse dashboards, using defaults:", err.message);
    }

    return { themes: themesResult, network: networkResult, config, dashboards };

  } catch (err) {
    console.error("Error fetching Home Assistant data:", err.message || err);
    if (err.code) console.error(`[DEBUG] Error code: ${err.code}`);
    if (err.cause) console.error(`[DEBUG] Error cause:`, err.cause);
    return { themes: null, network: null, config: null, dashboards: null };
  }
}

// =============================================================================
// ERROR PAGE HANDLERS
// =============================================================================

/**
 * Serves the missing configuration error page
 * Shown when no access token is configured
 * @param {http.ServerResponse} response - HTTP response object
 */
async function serveMissingConfigPage(response) {
  const htmlPath = join(HTML_DIR, "error_missing_config.html");
  let html = await readFile(htmlPath, "utf-8");

  html = html.replace("{{CONFIG_INSTRUCTIONS}}", generateConfigInstructions("Configure"));
  html = html.replace("{{HASS_URL}}", hassUrl);

  sendHtmlResponse(response, html);
}

/**
 * Serves the connection failed error page
 * Shown when unable to connect to Home Assistant
 * @param {http.ServerResponse} response - HTTP response object
 */
async function serveConnectionFailedPage(response) {
  const htmlPath = join(HTML_DIR, "error_connection_failed.html");
  let html = await readFile(htmlPath, "utf-8");

  html = html.replace("{{CONFIG_INSTRUCTIONS}}", generateConfigInstructions("Update"));
  html = html.replace(/{{HASS_URL}}/g, hassUrl);
  html = html.replace("{{TOKEN_LENGTH}}", String(hassToken?.length || 0));

  sendHtmlResponse(response, html);
}

// =============================================================================
// MAIN UI HANDLER
// =============================================================================

/**
 * Handles requests for the web UI
 * Serves appropriate page based on configuration and connection status
 * @param {http.ServerResponse} response - HTTP response object
 */
export async function handleUIRequest(response) {
  try {
    // Show setup instructions if no token configured
    if (!hassToken) {
      await serveMissingConfigPage(response);
      return;
    }

    // Fetch Home Assistant data
    const hassData = await fetchHomeAssistantData();

    // Show connection error if data fetch failed
    if (!hassData.themes || !hassData.network || !hassData.config) {
      await serveConnectionFailedPage(response);
      return;
    }

    // Serve main UI with injected Home Assistant data
    const htmlPath = join(HTML_DIR, "index.html");
    let html = await readFile(htmlPath, "utf-8");

    // Load device presets and add to hass data
    const presets = loadDevicesConfig();
    const hassDataWithDevices = {
      ...hassData,
      presets: presets
    };

    // Inject window.hass data for client-side JavaScript
    const scriptTag = `<script>window.hass = ${JSON.stringify(hassDataWithDevices, null, 2)};</script>`;
    html = html.replace("</head>", `${scriptTag}\n  </head>`);

    sendHtmlResponse(response, html);

  } catch (err) {
    console.error("Error serving UI:", err);
    response.statusCode = 500;
    response.end("Error loading UI");
  }
}
