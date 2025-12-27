/**
 * Mock Home Assistant Server
 * Provides minimal HTTP + WebSocket API compatible with Browser class for testing
 * @module tests/mocks/ha-server
 */

import http from 'node:http';
import { WebSocketServer } from 'ws';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Mock Home Assistant server for testing and local development
 * Mimics HA's HTTP and WebSocket APIs without requiring a real HA instance
 */
export class MockHAServer {
  /**
   * Creates a new mock HA server
   * @param {number} [port=8123] - Port to run server on (default matches real HA)
   */
  constructor(port = 8123) {
    this.port = port;
    this.httpServer = null;
    this.wsServer = null;
    this.fixtures = {};
    this.wsMessageId = 1;
  }

  /**
   * Starts the mock HA server (HTTP + WebSocket)
   * @returns {Promise<void>}
   */
  async start() {
    console.log('[MockHA] Starting server...');

    // Load fixture data
    await this._loadFixtures();

    // Start HTTP server
    this.httpServer = http.createServer(this._handleRequest.bind(this));

    // Start WebSocket server on same port
    this.wsServer = new WebSocketServer({ server: this.httpServer });
    this.wsServer.on('connection', this._handleWSConnection.bind(this));

    // Listen on configured port
    await new Promise((resolve, reject) => {
      this.httpServer.listen(this.port, (err) => {
        if (err) reject(err);
        else resolve();
      });
      this.httpServer.on('error', reject);
    });

    console.log(`[MockHA] Server started on http://localhost:${this.port}`);
    console.log(`[MockHA] WebSocket server ready for connections`);
  }

  /**
   * Stops the mock HA server
   * @returns {Promise<void>}
   */
  async stop() {
    console.log('[MockHA] Stopping server...');

    if (this.wsServer) {
      this.wsServer.close();
      this.wsServer = null;
    }

    if (this.httpServer) {
      await new Promise((resolve) => {
        this.httpServer.close(resolve);
      });
      this.httpServer = null;
    }

    console.log('[MockHA] Server stopped');
  }

  /**
   * Loads fixture data from JSON files
   * @private
   * @returns {Promise<void>}
   */
  async _loadFixtures() {
    const fixturesDir = join(__dirname, 'fixtures');

    try {
      this.fixtures.themes = JSON.parse(
        await readFile(join(fixturesDir, 'themes.json'), 'utf-8')
      );
      this.fixtures.network = JSON.parse(
        await readFile(join(fixturesDir, 'network.json'), 'utf-8')
      );
      this.fixtures.config = JSON.parse(
        await readFile(join(fixturesDir, 'config.json'), 'utf-8')
      );

      console.log('[MockHA] Fixtures loaded successfully');
    } catch (error) {
      console.error('[MockHA] Failed to load fixtures:', error.message);
      throw error;
    }
  }

  /**
   * Handles incoming HTTP requests
   * @private
   * @param {http.IncomingMessage} req - Request object
   * @param {http.ServerResponse} res - Response object
   */
  async _handleRequest(req, res) {
    const url = new URL(req.url, `http://localhost:${this.port}`);

    console.log(`[MockHA] ${req.method} ${url.pathname}`);

    try {
      // REST API endpoints
      if (url.pathname === '/api/config') {
        return this._sendJSON(res, 200, this.fixtures.config);
      }

      if (url.pathname === '/api/states') {
        return this._sendJSON(res, 200, []);
      }

      if (url.pathname === '/api/services') {
        return this._sendJSON(res, 200, []);
      }

      // HTML pages
      const page = await this._getPageForPath(url.pathname);
      if (page) {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache'
        });
        res.end(page);
        return;
      }

      // 404 Not Found
      console.log(`[MockHA] 404: ${url.pathname}`);
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>404 Not Found</h1><p>Page not found in mock HA</p></body></html>');

    } catch (error) {
      console.error('[MockHA] Request error:', error);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  }

  /**
   * Sends JSON response
   * @private
   * @param {http.ServerResponse} res - Response object
   * @param {number} status - HTTP status code
   * @param {Object} data - Data to send as JSON
   */
  _sendJSON(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  /**
   * Gets HTML page content for a given path
   * @private
   * @param {string} pathname - URL pathname
   * @returns {Promise<string|null>} HTML content or null if not found
   */
  async _getPageForPath(pathname) {
    const pagesDir = join(__dirname, 'pages');

    // Map URL paths to HTML files
    const pageMap = {
      '/': 'base.html',
      '/lovelace/0': 'lovelace-0.html',
      '/lovelace/1': 'lovelace-1.html',
      '/home': 'lovelace-0.html',  // Alias for default dashboard
    };

    const file = pageMap[pathname];
    if (!file) return null;

    try {
      const content = await readFile(join(pagesDir, file), 'utf-8');
      return content;
    } catch (error) {
      console.error(`[MockHA] Failed to read page ${file}:`, error.message);
      return null;
    }
  }

  /**
   * Handles WebSocket connections
   * @private
   * @param {import('ws').WebSocket} ws - WebSocket connection
   */
  _handleWSConnection(ws) {
    console.log('[MockHA] WebSocket client connected');

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        console.log('[MockHA] WS Message:', msg.type, `(id: ${msg.id})`);

        this._handleWSMessage(ws, msg);
      } catch (error) {
        console.error('[MockHA] WS message parse error:', error);
      }
    });

    ws.on('close', () => {
      console.log('[MockHA] WebSocket client disconnected');
    });

    ws.on('error', (error) => {
      console.error('[MockHA] WebSocket error:', error);
    });
  }

  /**
   * Handles individual WebSocket messages
   * @private
   * @param {import('ws').WebSocket} ws - WebSocket connection
   * @param {Object} msg - Parsed message
   */
  _handleWSMessage(ws, msg) {
    // Handle different message types
    if (msg.type === 'auth') {
      // Accept any auth token in mock mode
      this._sendWSMessage(ws, {
        type: 'auth_ok',
        ha_version: '2024.1.0'
      });
      return;
    }

    if (msg.type === 'frontend/get_themes') {
      this._sendWSMessage(ws, {
        id: msg.id,
        type: 'result',
        success: true,
        result: this.fixtures.themes
      });
      return;
    }

    if (msg.type === 'network/url') {
      this._sendWSMessage(ws, {
        id: msg.id,
        type: 'result',
        success: true,
        result: this.fixtures.network
      });
      return;
    }

    if (msg.type === 'config/core/check_config') {
      this._sendWSMessage(ws, {
        id: msg.id,
        type: 'result',
        success: true,
        result: { valid: true }
      });
      return;
    }

    // Default: success response for unknown message types
    this._sendWSMessage(ws, {
      id: msg.id,
      type: 'result',
      success: true,
      result: {}
    });
  }

  /**
   * Sends a WebSocket message
   * @private
   * @param {import('ws').WebSocket} ws - WebSocket connection
   * @param {Object} msg - Message to send
   */
  _sendWSMessage(ws, msg) {
    if (ws.readyState === 1) {  // OPEN
      ws.send(JSON.stringify(msg));
    }
  }
}

// Allow running standalone for testing and development
if (import.meta.url === `file://${process.argv[1]}`) {
  // Support command-line port argument or environment variable
  const port = parseInt(process.argv[2]) || parseInt(process.env.MOCK_HA_PORT) || 8123;
  const server = new MockHAServer(port);

  try {
    await server.start();
    console.log('\n✓ Mock HA server is running');
    console.log(`  Open http://localhost:${port} in your browser`);
    console.log('  Available endpoints:');
    console.log(`    - http://localhost:${port}/                 (base page)`);
    console.log(`    - http://localhost:${port}/lovelace/0       (dashboard 0)`);
    console.log(`    - http://localhost:${port}/lovelace/1       (dashboard 1)`);
    console.log(`    - http://localhost:${port}/api/config       (system config)`);
    console.log('  Press Ctrl+C to stop\n');

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n\nShutting down...');
      await server.stop();
      process.exit(0);
    });
  } catch (error) {
    console.error('Failed to start mock HA server:', error);
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Try a different port:`);
      console.error(`  node tests/mocks/ha-server.js 8124`);
      console.error(`  MOCK_HA_PORT=8124 node tests/mocks/ha-server.js`);
    }
    process.exit(1);
  }
}
