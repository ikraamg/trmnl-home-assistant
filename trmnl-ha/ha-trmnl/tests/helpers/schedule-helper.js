/**
 * Schedule Helper Utilities
 *
 * Utilities for creating and managing test schedules with fast cron expressions
 * @module tests/helpers/schedule-helper
 */

import fs from 'node:fs'
import path from 'node:path'

/**
 * Creates a test schedule with sensible defaults
 *
 * @param {Object} overrides - Properties to override defaults
 * @returns {Object} Schedule object
 *
 * @example
 * const schedule = createTestSchedule({
 *   name: 'My Test',
 *   cron: '2 * * * * *',
 *   webhook_url: 'http://localhost:10002/webhook'
 * });
 */
export function createTestSchedule(overrides = {}) {
  const defaults = {
    name: 'Test Schedule',
    dashboard_path: '/lovelace/0',
    viewport: '800x480',
    enabled: true,
    cron: '*/5 * * * * *', // Every 5 seconds by default
    format: 'png',
    zoom: 1,
    wait: 0,
    invert: false,
    dark: false,
    webhook_url: null,
    webhook_headers: {},
    dithering: {
      enabled: false,
    },
  }

  return { ...defaults, ...overrides }
}

/**
 * Creates a schedule with a fast cron expression for testing
 * Useful for testing cron job execution without waiting too long
 *
 * @param {number} seconds - Interval in seconds (default: 2)
 * @returns {Object} Schedule object with fast cron
 *
 * @example
 * const schedule = createFastCronSchedule(2); // Runs every 2 seconds
 */
export function createFastCronSchedule(seconds = 2) {
  return createTestSchedule({
    name: `Fast Cron (${seconds}s)`,
    cron: `*/${seconds} * * * * *`,
  })
}

/**
 * Creates a schedule with webhook configuration
 *
 * @param {string} webhookUrl - Webhook URL
 * @param {Object} headers - Optional custom headers
 * @returns {Object} Schedule object with webhook
 *
 * @example
 * const schedule = createWebhookSchedule('http://localhost:10002/test', {
 *   'Authorization': 'Bearer token123'
 * });
 */
export function createWebhookSchedule(webhookUrl, headers = {}) {
  return createTestSchedule({
    name: 'Webhook Test',
    webhook_url: webhookUrl,
    webhook_headers: headers,
  })
}

/**
 * Cleanup a schedule file if it exists
 *
 * @param {string} filePath - Path to schedule file
 *
 * @example
 * cleanupScheduleFile('./test-schedules.json');
 */
export function cleanupScheduleFile(filePath) {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
  }
}

/**
 * Writes schedules to a test file
 *
 * @param {string} filePath - Path to schedule file
 * @param {Array<Object>} schedules - Array of schedule objects
 *
 * @example
 * writeScheduleFile('./test-schedules.json', [schedule1, schedule2]);
 */
export function writeScheduleFile(filePath, schedules) {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(filePath, JSON.stringify(schedules, null, 2))
}

/**
 * Reads schedules from a test file
 *
 * @param {string} filePath - Path to schedule file
 * @returns {Array<Object>} Array of schedule objects
 *
 * @example
 * const schedules = readScheduleFile('./test-schedules.json');
 */
export function readScheduleFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return []
  }
  const content = fs.readFileSync(filePath, 'utf-8')
  return JSON.parse(content)
}
