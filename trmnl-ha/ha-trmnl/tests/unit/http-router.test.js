/**
 * Unit tests for HTTP Router (lib/http-router.js)
 *
 * Tests core routing logic and injected dependency behavior.
 *
 * Testing Philosophy (from Alchemists.io):
 * - Unit tests mock INJECTED dependencies (healthMonitor, recoveryManager, scheduler)
 * - Integration-style tests for routes that depend on filesystem (schedules, devices, static files)
 * - Spy pattern: verify calls AFTER actions
 * - One expectation per test (consolidated with toMatchObject where appropriate)
 * - Focus on testable behavior without fighting ES module mocking
 *
 * NOTE: Some routes (schedules API, devices API) are thin wrappers around scheduleStore/devices modules.
 * Those modules have their own comprehensive tests. Here we focus on routing logic and error handling.
 *
 * @module tests/unit/http-router
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import { HttpRouter } from '../../lib/http-router.js'

describe('HttpRouter', () => {
  let router
  let mockHealthMonitor
  let mockRecoveryManager
  let mockScheduler
  let mockRequest
  let mockResponse

  // Helper to create fake HTTP request
  const createRequest = (method = 'GET') => ({
    method,
    on: (event, callback) => {
      if (event === 'end') callback()
    },
  })

  // Helper to create fake HTTP response with spy methods
  const createResponse = () => {
    const response = {
      statusCode: null,
      headers: {},
      body: '',
      setHeader: (key, value) => {
        response.headers[key.toLowerCase()] = value
      },
      writeHead: (code, headers = {}) => {
        response.statusCode = code
        Object.entries(headers).forEach(([key, value]) => {
          response.headers[key.toLowerCase()] = value
        })
      },
      end: (data) => {
        if (data) response.body = data
      },
    }
    return response
  }

  beforeEach(() => {
    // Create mock dependencies (these are injected, so easily mockable)
    mockHealthMonitor = {
      checkHealth: () => ({
        healthy: true,
        lastCheck: new Date().toISOString(),
        consecutiveFailures: 0,
      }),
    }

    mockRecoveryManager = {
      getStats: () => ({
        recoveryCount: 0,
        lastRecovery: null,
        totalRestarts: 0,
      }),
    }

    mockScheduler = {
      executeNow: async (id) => ({
        id,
        executed: true,
        timestamp: new Date().toISOString(),
      }),
    }

    // Create router instance
    router = new HttpRouter(mockHealthMonitor, mockRecoveryManager)

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

      const handled = await router.route(mockRequest, mockResponse, url)

      expect(handled).toBe(true)
    })

    it('returns false for unrecognized routes', async () => {
      const url = new URL('http://localhost/screenshot')

      const handled = await router.route(mockRequest, mockResponse, url)

      expect(handled).toBe(false)
    })
  })

  // ==========================================================================
  // Health Check Endpoint - GET /health
  // ==========================================================================

  describe('GET /health', () => {
    it('returns 200 when browser is healthy', async () => {
      mockHealthMonitor.checkHealth = () => ({ healthy: true })
      const url = new URL('http://localhost/health')

      await router.route(mockRequest, mockResponse, url)

      expect(mockResponse.statusCode).toBe(200)
    })

    it('returns 503 when browser is degraded', async () => {
      mockHealthMonitor.checkHealth = () => ({ healthy: false })
      const url = new URL('http://localhost/health')

      await router.route(mockRequest, mockResponse, url)

      expect(mockResponse.statusCode).toBe(503)
    })

    it('includes browser health metrics in response body', async () => {
      mockHealthMonitor.checkHealth = () => ({
        healthy: true,
        lastCheck: '2024-01-01T00:00:00.000Z',
        consecutiveFailures: 0,
      })
      mockRecoveryManager.getStats = () => ({
        recoveryCount: 5,
        lastRecovery: '2024-01-01T00:00:00.000Z',
      })
      const url = new URL('http://localhost/health')

      await router.route(mockRequest, mockResponse, url)

      const response = JSON.parse(mockResponse.body)

      expect(response).toMatchObject({
        status: 'ok',
        browser: {
          healthy: true,
          recoveryCount: 5,
        },
      })
    })

    it('sets Content-Type header to application/json', async () => {
      const url = new URL('http://localhost/health')

      await router.route(mockRequest, mockResponse, url)

      expect(mockResponse.headers['content-type']).toBe('application/json')
    })

    it('includes uptime in response', async () => {
      const url = new URL('http://localhost/health')

      await router.route(mockRequest, mockResponse, url)

      const response = JSON.parse(mockResponse.body)

      expect(response.uptime).toBeGreaterThan(0)
    })

    it('includes ISO timestamp in response', async () => {
      const url = new URL('http://localhost/health')

      await router.route(mockRequest, mockResponse, url)

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

      await router.route(mockRequest, mockResponse, url)

      expect(mockResponse.statusCode).toBe(404)
    })

    it('handles route (returns true)', async () => {
      const url = new URL('http://localhost/favicon.ico')

      const handled = await router.route(mockRequest, mockResponse, url)

      expect(handled).toBe(true)
    })
  })

  // ==========================================================================
  // Manual Execution - POST /api/schedules/:id/send
  // ==========================================================================

  describe('POST /api/schedules/:id/send', () => {
    beforeEach(() => {
      // Set scheduler for these tests
      router.setScheduler(mockScheduler)
      mockRequest = createRequest('POST')
    })

    it('triggers schedule execution via scheduler', async () => {
      let executedId = null
      mockScheduler.executeNow = async (id) => {
        executedId = id
        return { id, executed: true }
      }

      const url = new URL('http://localhost/api/schedules/123/send')

      await router.route(mockRequest, mockResponse, url)

      expect(executedId).toBe('123')
    })

    it('extracts schedule ID correctly from URL path', async () => {
      let executedId = null
      mockScheduler.executeNow = async (id) => {
        executedId = id
        return { id, executed: true }
      }

      const url = new URL('http://localhost/api/schedules/abc-456-def/send')

      await router.route(mockRequest, mockResponse, url)

      expect(executedId).toBe('abc-456-def')
    })

    it('returns 200 on successful execution', async () => {
      const url = new URL('http://localhost/api/schedules/123/send')

      await router.route(mockRequest, mockResponse, url)

      expect(mockResponse.statusCode).toBe(200)
    })

    it('includes success flag in response', async () => {
      const url = new URL('http://localhost/api/schedules/123/send')

      await router.route(mockRequest, mockResponse, url)

      const response = JSON.parse(mockResponse.body)

      expect(response.success).toBe(true)
    })

    it('includes execution result in response', async () => {
      mockScheduler.executeNow = async (id) => ({
        id,
        executed: true,
        screenshot: '/output/test.png',
        webhookSent: true,
      })

      const url = new URL('http://localhost/api/schedules/123/send')

      await router.route(mockRequest, mockResponse, url)

      const response = JSON.parse(mockResponse.body)

      expect(response).toMatchObject({
        success: true,
        screenshot: '/output/test.png',
        webhookSent: true,
      })
    })

    it('returns 405 for non-POST methods', async () => {
      mockRequest = createRequest('GET')
      const url = new URL('http://localhost/api/schedules/123/send')

      await router.route(mockRequest, mockResponse, url)

      expect(mockResponse.statusCode).toBe(405)
    })

    it('returns 503 when scheduler not initialized', async () => {
      // Create router without scheduler
      const routerNoScheduler = new HttpRouter(
        mockHealthMonitor,
        mockRecoveryManager
      )

      const url = new URL('http://localhost/api/schedules/123/send')

      await routerNoScheduler.route(mockRequest, mockResponse, url)

      expect(mockResponse.statusCode).toBe(503)
    })

    it('returns 404 when schedule not found', async () => {
      mockScheduler.executeNow = async () => {
        throw new Error('Schedule not found')
      }

      const url = new URL('http://localhost/api/schedules/999/send')

      await router.route(mockRequest, mockResponse, url)

      expect(mockResponse.statusCode).toBe(404)
    })

    it('returns 500 for other execution errors', async () => {
      mockScheduler.executeNow = async () => {
        throw new Error('Browser crashed')
      }

      const url = new URL('http://localhost/api/schedules/123/send')

      await router.route(mockRequest, mockResponse, url)

      expect(mockResponse.statusCode).toBe(500)
    })

    it('sets Content-Type header to application/json', async () => {
      const url = new URL('http://localhost/api/schedules/123/send')

      await router.route(mockRequest, mockResponse, url)

      expect(mockResponse.headers['content-type']).toBe('application/json')
    })
  })

  // ==========================================================================
  // Route Precedence - /send must be checked before generic ID routes
  // ==========================================================================

  describe('Route Precedence', () => {
    it('recognizes /api/schedules/:id/send as send endpoint', async () => {
      router.setScheduler(mockScheduler)
      mockRequest = createRequest('POST')
      const url = new URL('http://localhost/api/schedules/send/send')

      await router.route(mockRequest, mockResponse, url)

      // Should route to send handler (405 for non-POST, or 200 if POST)
      // Not to the generic ID handler which would try to update schedule with ID "send"
      expect(mockResponse.statusCode).toBe(200) // POST to /send endpoint
    })
  })

  // ==========================================================================
  // setScheduler() - Two-phase initialization
  // ==========================================================================

  describe('setScheduler', () => {
    it('allows scheduler to be set after construction', () => {
      const newRouter = new HttpRouter(mockHealthMonitor, mockRecoveryManager)

      newRouter.setScheduler(mockScheduler)

      // Verify scheduler was set (implicit - no error thrown)
      expect(() => newRouter.setScheduler(mockScheduler)).not.toThrow()
    })

    it('enables /send endpoint after scheduler is set', async () => {
      const newRouter = new HttpRouter(mockHealthMonitor, mockRecoveryManager)

      // Before setting scheduler - should return 503
      mockRequest = createRequest('POST')
      const url = new URL('http://localhost/api/schedules/123/send')
      await newRouter.route(mockRequest, mockResponse, url)
      expect(mockResponse.statusCode).toBe(503)

      // After setting scheduler - should work
      newRouter.setScheduler(mockScheduler)
      mockResponse = createResponse()
      await newRouter.route(mockRequest, mockResponse, url)
      expect(mockResponse.statusCode).toBe(200)
    })
  })

  // ==========================================================================
  // Unrecognized Routes - Fallback behavior
  // ==========================================================================

  describe('Unrecognized Routes', () => {
    it('returns false for screenshot requests', async () => {
      const url = new URL('http://localhost/lovelace/0')

      const handled = await router.route(mockRequest, mockResponse, url)

      expect(handled).toBe(false)
    })

    it('returns false for unknown paths', async () => {
      const url = new URL('http://localhost/unknown/path')

      const handled = await router.route(mockRequest, mockResponse, url)

      expect(handled).toBe(false)
    })
  })
})
