/**
 * Test utilities for managing mock HA server
 * @module tests/helpers/mock-helper
 */

import { MockHAServer } from '../mocks/ha-server.js'

/**
 * Starts mock HA server for testing
 * @param {number} [port=8123] - Port to run server on
 * @returns {Promise<MockHAServer>} Running server instance
 */
export async function startMockHA(port = 8123) {
  const server = new MockHAServer(port)
  await server.start()
  return server
}

/**
 * Stops mock HA server
 * @param {MockHAServer} server - Server instance to stop
 * @returns {Promise<void>}
 */
export async function stopMockHA(server) {
  if (server) {
    await server.stop()
  }
}

/**
 * Sets up complete test environment with mock HA
 * Use in beforeAll() hooks
 * @param {number} [port=8123] - Port for mock server
 * @returns {Promise<{server: MockHAServer}>} Test environment
 */
export async function setupTestEnvironment(port = 8123) {
  // Set mock mode environment variable
  process.env.MOCK_HA = 'true'

  // Start mock HA server
  const server = await startMockHA(port)

  // Give server a moment to fully initialize
  await new Promise((resolve) => setTimeout(resolve, 100))

  return { server }
}

/**
 * Tears down test environment
 * Use in afterAll() hooks
 * @param {{server: MockHAServer}} env - Test environment from setupTestEnvironment
 * @returns {Promise<void>}
 */
export async function teardownTestEnvironment({ server }) {
  await stopMockHA(server)
  delete process.env.MOCK_HA
}

/**
 * Waits for a condition to be true with timeout
 * @param {Function} condition - Function that returns true when condition is met
 * @param {number} [timeout=5000] - Maximum time to wait in milliseconds
 * @param {number} [interval=100] - Check interval in milliseconds
 * @returns {Promise<void>}
 * @throws {Error} If timeout is reached
 */
export async function waitFor(condition, timeout = 5000, interval = 100) {
  const start = Date.now()

  while (Date.now() - start < timeout) {
    if (await condition()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, interval))
  }

  throw new Error(`Timeout waiting for condition after ${timeout}ms`)
}

/**
 * Waits for a condition to be met N times
 * Useful for testing cron jobs that should execute multiple times
 * @param {Function} conditionFn - Function that returns current count
 * @param {number} count - Target count to wait for
 * @param {number} [timeout=10000] - Maximum time to wait in milliseconds
 * @param {number} [interval=100] - Check interval in milliseconds
 * @returns {Promise<void>}
 * @throws {Error} If timeout is reached
 *
 * @example
 * const executions = [];
 * await waitForCount(() => executions.length, 3, 5000);
 * // Will wait until executions.length >= 3
 */
export async function waitForCount(
  conditionFn,
  count,
  timeout = 10000,
  interval = 100
) {
  const start = Date.now()

  while (Date.now() - start < timeout) {
    const currentCount = await conditionFn()
    if (currentCount >= count) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, interval))
  }

  const finalCount = await conditionFn()
  throw new Error(
    `Timeout waiting for count ${count} after ${timeout}ms (got ${finalCount})`
  )
}

/**
 * Waits for a specific duration
 * More reliable than setTimeout for cron timing tests
 * @param {number} ms - Duration to wait in milliseconds
 * @returns {Promise<void>}
 *
 * @example
 * await waitForDuration(2000); // Wait exactly 2 seconds
 */
export async function waitForDuration(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
