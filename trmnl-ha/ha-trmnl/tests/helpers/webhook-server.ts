/**
 * Webhook Test Server
 *
 * Real HTTP server for testing webhook delivery in integration tests.
 * Receives POST requests and stores them for inspection.
 * @module tests/helpers/webhook-server
 */

import http from 'node:http'
import type { IncomingMessage, ServerResponse, Server } from 'node:http'

/** Recorded webhook request structure */
interface WebhookRequest {
  method: string | undefined
  url: string | undefined
  headers: http.IncomingHttpHeaders
  body: Buffer
  timestamp: Date
}

/**
 * Test server that receives and records webhook POST requests
 */
export class WebhookTestServer {
  port: number
  server: Server | null = null
  requests: WebhookRequest[] = []
  responseStatus: number = 200
  responseBody: string = ''
  responseDelay: number = 0

  constructor(port: number = 10002) {
    this.port = port
  }

  /**
   * Start the HTTP server
   */
  async start(): Promise<void> {
    if (this.server) {
      throw new Error('Server already started')
    }

    this.server = http.createServer((req, res) => {
      this._handleRequest(req, res)
    })

    return new Promise((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(this.port, () => {
        console.log(`[WebhookTestServer] Started on port ${this.port}`)
        resolve()
      })
    })
  }

  /**
   * Stop the HTTP server
   */
  async stop(): Promise<void> {
    if (!this.server) {
      return
    }

    return new Promise((resolve, reject) => {
      this.server!.close((err) => {
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
   */
  private async _handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = []

    req.on('data', (chunk: Buffer) => chunks.push(chunk))

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
   */
  getRequests(): WebhookRequest[] {
    return this.requests
  }

  /**
   * Clear all recorded requests
   */
  clearRequests(): void {
    this.requests = []
  }

  /**
   * Set the HTTP status code to return for all requests
   */
  setResponseStatus(status: number): void {
    this.responseStatus = status
  }

  /**
   * Set the response body to return for all requests
   */
  setResponseBody(body: string): void {
    this.responseBody = body
  }

  /**
   * Set a delay before responding to simulate slow webhooks
   */
  setResponseDelay(ms: number): void {
    this.responseDelay = ms
  }

  /**
   * Reset server to default configuration
   */
  reset(): void {
    this.clearRequests()
    this.responseStatus = 200
    this.responseBody = ''
    this.responseDelay = 0
  }
}
