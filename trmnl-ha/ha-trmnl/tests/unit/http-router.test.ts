/**
 * Unit tests for HTTP Router
 *
 * @module tests/unit/http-router
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import { HttpRouter } from '../../lib/http-router.js'
import type { BrowserFacade } from '../../lib/browserFacade.js'

/** Mock HTTP request */
interface MockRequest {
  method: string
  on: (event: string, callback: () => void) => void
}

/** Mock HTTP response */
interface MockResponse {
  statusCode: number | null
  headers: Record<string, string>
  body: string
  setHeader: (key: string, value: string) => void
  writeHead: (code: number, headers?: Record<string, string>) => void
  end: (data?: string) => void
}

describe('HttpRouter', () => {
  let router: HttpRouter
  let mockFacade: BrowserFacade
  let mockScheduler: { executeNow: (id: string) => Promise<unknown> }
  let mockRequest: MockRequest
  let mockResponse: MockResponse

  // Helper to create fake HTTP request
  const createRequest = (method: string = 'GET'): MockRequest => ({
    method,
    on: (event: string, callback: () => void) => {
      if (event === 'end') callback()
    },
  })

  // Helper to create fake HTTP response with spy methods
  const createResponse = (): MockResponse => {
    const response: MockResponse = {
      statusCode: null,
      headers: {},
      body: '',
      setHeader: (key: string, value: string) => {
        response.headers[key.toLowerCase()] = value
      },
      writeHead: (code: number, headers: Record<string, string> = {}) => {
        response.statusCode = code
        Object.entries(headers).forEach(([key, value]) => {
          response.headers[key.toLowerCase()] = value
        })
      },
      end: (data?: string) => {
        if (data) response.body = data
      },
    }
    return response
  }

  beforeEach(() => {
    // Create mock facade (combines health + recovery)
    mockFacade = {
      checkHealth: () => ({ healthy: true }),
      getStats: () => ({
        lastSuccessfulRequest: new Date().toISOString(),
        timeSinceSuccess: 0,
        consecutiveFailures: 0,
        totalRecoveries: 0,
        recovering: false,
      }),
    } as unknown as BrowserFacade

    mockScheduler = {
      executeNow: async (id: string) => ({
        id,
        executed: true,
        timestamp: new Date().toISOString(),
      }),
    }

    // Create router instance
    router = new HttpRouter(mockFacade)

    // Create fake request/response
    mockRequest = createRequest()
    mockResponse = createResponse()
  })

  // ==========================================================================
  // route() - Main routing logic (return values)
  // ==========================================================================

  describe('route', () => {
    it('returns true when route is recognized', async () => {
      const url = new URL('http://localhost/health')

      const handled = await router.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url
      )

      expect(handled).toBe(true)
    })

    it('returns false for unrecognized routes', async () => {
      const url = new URL('http://localhost/screenshot')

      const handled = await router.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url
      )

      expect(handled).toBe(false)
    })
  })

  // ==========================================================================
  // Health Check Endpoint - GET /health
  // ==========================================================================

  describe('GET /health', () => {
    it('returns 200 when browser is healthy', async () => {
      ;(mockFacade as { checkHealth: () => { healthy: boolean } }).checkHealth = () => ({
        healthy: true,
      })
      const url = new URL('http://localhost/health')

      await router.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url
      )

      expect(mockResponse.statusCode).toBe(200)
    })

    it('returns 503 when browser is degraded', async () => {
      ;(mockFacade as { checkHealth: () => { healthy: boolean } }).checkHealth = () => ({
        healthy: false,
      })
      const url = new URL('http://localhost/health')

      await router.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url
      )

      expect(mockResponse.statusCode).toBe(503)
    })

    it('includes browser health metrics in response body', async () => {
      ;(mockFacade as { checkHealth: () => unknown }).checkHealth = () => ({
        healthy: true,
      })
      ;(mockFacade as { getStats: () => unknown }).getStats = () => ({
        lastSuccessfulRequest: '2024-01-01T00:00:00.000Z',
        timeSinceSuccess: 0,
        consecutiveFailures: 0,
        totalRecoveries: 5,
        recovering: false,
      })
      const url = new URL('http://localhost/health')

      await router.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url
      )

      const response = JSON.parse(mockResponse.body)

      expect(response).toMatchObject({
        status: 'ok',
        browser: {
          healthy: true,
          totalRecoveries: 5,
        },
      })
    })

    it('sets Content-Type header to application/json', async () => {
      const url = new URL('http://localhost/health')

      await router.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url
      )

      expect(mockResponse.headers['content-type']).toBe('application/json')
    })

    it('includes uptime in response', async () => {
      const url = new URL('http://localhost/health')

      await router.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url
      )

      const response = JSON.parse(mockResponse.body)

      expect(response.uptime).toBeGreaterThan(0)
    })

    it('includes ISO timestamp in response', async () => {
      const url = new URL('http://localhost/health')

      await router.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url
      )

      const response = JSON.parse(mockResponse.body)

      expect(response.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })
  })

  // ==========================================================================
  // Favicon - GET /favicon.ico
  // ==========================================================================

  describe('GET /favicon.ico', () => {
    it('returns 404 for favicon requests', async () => {
      const url = new URL('http://localhost/favicon.ico')

      await router.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url
      )

      expect(mockResponse.statusCode).toBe(404)
    })

    it('handles route (returns true)', async () => {
      const url = new URL('http://localhost/favicon.ico')

      const handled = await router.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url
      )

      expect(handled).toBe(true)
    })
  })

  // ==========================================================================
  // Manual Execution - POST /api/schedules/:id/send
  // ==========================================================================

  describe('POST /api/schedules/:id/send', () => {
    // Use local scheduler for this describe block to avoid parallel test interference
    let localScheduler: typeof mockScheduler

    beforeEach(() => {
      // Create fresh mock scheduler with default successful behavior
      // Must return { success: boolean; savedPath: string } to match interface
      localScheduler = {
        executeNow: async (_id: string) => ({
          success: true,
          savedPath: '/output/test.png',
        }),
      }
      // Set scheduler for these tests
      router.setScheduler(localScheduler as Parameters<typeof router.setScheduler>[0])
      mockRequest = createRequest('POST')
    })

    it('triggers schedule execution via scheduler', async () => {
      let executedId: string | undefined
      localScheduler.executeNow = async (id: string) => {
        executedId = id
        return { id, executed: true }
      }

      const url = new URL('http://localhost/api/schedules/123/send')

      await router.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url
      )

      expect(executedId).toBe('123')
    })

    it('extracts schedule ID correctly from URL path', async () => {
      let executedId: string | undefined
      localScheduler.executeNow = async (id: string) => {
        executedId = id
        return { id, executed: true }
      }

      const url = new URL('http://localhost/api/schedules/abc-456-def/send')

      await router.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url
      )

      expect(executedId).toBe('abc-456-def')
    })

    it('returns 200 on successful execution', async () => {
      const url = new URL('http://localhost/api/schedules/123/send')

      await router.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url
      )

      expect(mockResponse.statusCode).toBe(200)
    })

    it('includes success flag in response', async () => {
      const url = new URL('http://localhost/api/schedules/123/send')

      await router.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url
      )

      const response = JSON.parse(mockResponse.body)

      expect(response.success).toBe(true)
    })

    it('returns 405 for non-POST methods', async () => {
      mockRequest = createRequest('GET')
      const url = new URL('http://localhost/api/schedules/123/send')

      await router.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url
      )

      expect(mockResponse.statusCode).toBe(405)
    })

    it('returns 503 when scheduler not initialized', async () => {
      // Create router without scheduler
      const routerNoScheduler = new HttpRouter(mockFacade)

      const url = new URL('http://localhost/api/schedules/123/send')

      await routerNoScheduler.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url
      )

      expect(mockResponse.statusCode).toBe(503)
    })

    it('returns 404 when schedule not found', async () => {
      localScheduler.executeNow = async () => {
        throw new Error('Schedule not found')
      }

      const url = new URL('http://localhost/api/schedules/999/send')

      await router.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url
      )

      expect(mockResponse.statusCode).toBe(404)
    })

    it('returns 500 for other execution errors', async () => {
      localScheduler.executeNow = async () => {
        throw new Error('Browser crashed')
      }

      const url = new URL('http://localhost/api/schedules/123/send')

      await router.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url
      )

      expect(mockResponse.statusCode).toBe(500)
    })
  })

  // ==========================================================================
  // setScheduler() - Two-phase initialization
  // ==========================================================================

  describe('setScheduler', () => {
    it('allows scheduler to be set after construction', () => {
      const newRouter = new HttpRouter(mockFacade)

      newRouter.setScheduler(mockScheduler as Parameters<typeof router.setScheduler>[0])

      // Verify scheduler was set (implicit - no error thrown)
      expect(() =>
        { newRouter.setScheduler(mockScheduler as Parameters<typeof router.setScheduler>[0]); }
      ).not.toThrow()
    })

    it('enables /send endpoint after scheduler is set', async () => {
      const newRouter = new HttpRouter(mockFacade)

      // Before setting scheduler - should return 503
      mockRequest = createRequest('POST')
      const url = new URL('http://localhost/api/schedules/123/send')
      await newRouter.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url
      )
      expect(mockResponse.statusCode).toBe(503)

      // After setting scheduler - should work
      newRouter.setScheduler(mockScheduler as Parameters<typeof router.setScheduler>[0])
      mockResponse = createResponse()
      await newRouter.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url
      )
      expect(mockResponse.statusCode).toBe(200)
    })
  })

  // ==========================================================================
  // Unrecognized Routes - Fallback behavior
  // ==========================================================================

  describe('Unrecognized Routes', () => {
    it('returns false for screenshot requests', async () => {
      const url = new URL('http://localhost/lovelace/0')

      const handled = await router.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url
      )

      expect(handled).toBe(false)
    })

    it('returns false for unknown paths', async () => {
      const url = new URL('http://localhost/unknown/path')

      const handled = await router.route(
        mockRequest as unknown as import('node:http').IncomingMessage,
        mockResponse as unknown as import('node:http').ServerResponse,
        url
      )

      expect(handled).toBe(false)
    })
  })
})
