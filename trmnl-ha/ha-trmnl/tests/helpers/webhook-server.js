/**
 * Webhook Test Server
 *
 * Real HTTP server for testing webhook delivery in integration tests.
 * Receives POST requests and stores them for inspection.
 * @module tests/helpers/webhook-server
 */

import http from 'node:http'

/**
 * Test server that receives and records webhook POST requests
 *
 * @example
 * const server = new WebhookTestServer(10002);
 * await server.start();
 * // ... run tests ...
 * const requests = server.getRequests();
 * await server.stop();
 */
export class WebhookTestServer {
  /**
   * @param {number} port - Port to listen on (default: 10002)
   */
  constructor(port = 10002) {
    this.port = port
    this.server = null
    this.requests = []
    this.responseStatus = 200
    this.responseBody = ''
    this.responseDelay = 0
  }

  /**
   * Start the HTTP server
   * @returns {Promise<void>}
   */
  async start() {
    if (this.server) {
      throw new Error('Server already started')
    }

    this.server = http.createServer((req, res) => {
      this._handleRequest(req, res)
    })

    return new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(this.port, () => {
        console.log(`[WebhookTestServer] Started on port ${this.port}`)
        resolve()
      })
    })
  }

  /**
   * Stop the HTTP server
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.server) {
      return
    }

    return new Promise((resolve, reject) => {
      this.server.close((err) => {
        if (err) {
          reject(err)
        } else {
          console.log(`[WebhookTestServer] Stopped`)
          this.server = null
          resolve()
        }
      })
    })
  }

  /**
   * Handle incoming HTTP request
   * @private
   */
  async _handleRequest(req, res) {
    const chunks = []

    req.on('data', (chunk) => chunks.push(chunk))

    req.on('end', async () => {
      const body = Buffer.concat(chunks)

      // Record the request
      this.requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: body,
        timestamp: new Date(),
      })

      console.log(
        `[WebhookTestServer] Received ${req.method} ${req.url} - ${body.length} bytes`
      )

      // Apply delay if configured
      if (this.responseDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.responseDelay))
      }

      // Send response
      res.writeHead(this.responseStatus, {
        'Content-Type': 'text/plain',
      })
      res.end(this.responseBody)
    })

    req.on('error', (err) => {
      console.error(`[WebhookTestServer] Request error:`, err)
      res.writeHead(500)
      res.end('Internal Server Error')
    })
  }

  /**
   * Get all recorded webhook requests
   * @returns {Array<{method: string, url: string, headers: Object, body: Buffer, timestamp: Date}>}
   */
  getRequests() {
    return this.requests
  }

  /**
   * Clear all recorded requests
   */
  clearRequests() {
    this.requests = []
  }

  /**
   * Set the HTTP status code to return for all requests
   * @param {number} status - HTTP status code (e.g., 200, 404, 500)
   */
  setResponseStatus(status) {
    this.responseStatus = status
  }

  /**
   * Set the response body to return for all requests
   * @param {string} body - Response body text
   */
  setResponseBody(body) {
    this.responseBody = body
  }

  /**
   * Set a delay before responding to simulate slow webhooks
   * @param {number} ms - Delay in milliseconds
   */
  setResponseDelay(ms) {
    this.responseDelay = ms
  }

  /**
   * Reset server to default configuration
   */
  reset() {
    this.clearRequests()
    this.responseStatus = 200
    this.responseBody = ''
    this.responseDelay = 0
  }
}
