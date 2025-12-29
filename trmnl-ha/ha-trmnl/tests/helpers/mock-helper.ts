/**
 * Test utilities for managing mock HA server
 * @module tests/helpers/mock-helper
 */

import { MockHAServer } from '../mocks/ha-server.js'

/** Test environment structure */
export interface TestEnvironment {
  server: MockHAServer
}

/**
 * Starts mock HA server for testing
 */
export async function startMockHA(port: number = 8123): Promise<MockHAServer> {
  const server = new MockHAServer(port)
  await server.start()
  return server
}

/**
 * Stops mock HA server
 */
export async function stopMockHA(server: MockHAServer | null): Promise<void> {
  if (server) {
    await server.stop()
  }
}

/**
 * Sets up complete test environment with mock HA
 * Use in beforeAll() hooks
 */
export async function setupTestEnvironment(port: number = 8123): Promise<TestEnvironment> {
  // Set mock mode environment variable
  process.env['MOCK_HA'] = 'true'

  // Start mock HA server
  const server = await startMockHA(port)

  // Give server a moment to fully initialize
  await new Promise((resolve) => setTimeout(resolve, 100))

  return { server }
}

/**
 * Tears down test environment
 * Use in afterAll() hooks
 */
export async function teardownTestEnvironment({ server }: TestEnvironment): Promise<void> {
  await stopMockHA(server)
  delete process.env['MOCK_HA']
}

/**
 * Waits for a condition to be true with timeout
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout: number = 5000,
  interval: number = 100
): Promise<void> {
  const start = Date.now()

  while (Date.now() - start < timeout) {
    if (await condition()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, interval))
  }

  throw new Error(`Timeout waiting for condition after ${timeout}ms`)
}

