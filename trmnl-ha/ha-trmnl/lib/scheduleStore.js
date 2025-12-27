/**
 * Schedule Store Module
 *
 * Manages schedule persistence to JSON file
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// NOTE: For Home Assistant add-ons, use /data for persistence
// Check if we're running as an add-on (options.json exists in /data)
const isAddOn = fs.existsSync('/data/options.json')
const DEFAULT_SCHEDULES_FILE = isAddOn
  ? '/data/schedules.json' // HA add-on: use mounted /data volume
  : path.join(__dirname, '..', 'data', 'schedules.json') // Local dev: use app directory

/**
 * Load schedules from JSON file
 * @param {string} [filePath] - Optional custom file path (for testing)
 * @returns {Array} Array of schedule objects
 */
export function loadSchedules(filePath = DEFAULT_SCHEDULES_FILE) {
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8')
      return JSON.parse(data)
    }
  } catch (err) {
    console.error('Error loading schedules:', err)
  }
  return []
}

/**
 * Save schedules to JSON file
 * @param {string|Array} filePathOrSchedules - File path (string) or schedules array (for backward compat)
 * @param {Array} [schedules] - Array of schedule objects (if first param is file path)
 */
export function saveSchedules(filePathOrSchedules, schedules) {
  // Support both old API (schedules) and new API (filePath, schedules)
  const filePath =
    typeof filePathOrSchedules === 'string'
      ? filePathOrSchedules
      : DEFAULT_SCHEDULES_FILE
  const data =
    typeof filePathOrSchedules === 'string' ? schedules : filePathOrSchedules

  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
  } catch (err) {
    console.error('Error saving schedules:', err)
    throw err
  }
}

/**
 * Get a schedule by ID
 * @param {string|Object} filePathOrId - File path (string) or schedule ID (for backward compat)
 * @param {string} [id] - Schedule ID (if first param is file path)
 * @returns {Object|null} Schedule object or null if not found
 */
export function getSchedule(filePathOrId, id) {
  const filePath =
    typeof id === 'string' ? filePathOrId : DEFAULT_SCHEDULES_FILE
  const scheduleId = typeof id === 'string' ? id : filePathOrId

  const schedules = loadSchedules(filePath)
  return schedules.find((s) => s.id === scheduleId) || null
}

/**
 * Create a new schedule
 * @param {string|Object} filePathOrSchedule - File path (string) or schedule data (for backward compat)
 * @param {Object} [schedule] - Schedule data (if first param is file path)
 * @returns {Object} Created schedule with ID
 */
export function createSchedule(filePathOrSchedule, schedule) {
  const filePath =
    typeof filePathOrSchedule === 'string'
      ? filePathOrSchedule
      : DEFAULT_SCHEDULES_FILE
  const data =
    typeof filePathOrSchedule === 'string' ? schedule : filePathOrSchedule

  const schedules = loadSchedules(filePath)
  const newSchedule = {
    ...data,
    id: generateId(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  schedules.push(newSchedule)
  saveSchedules(filePath, schedules)
  return newSchedule
}

/**
 * Update an existing schedule
 * @param {string} filePathOrId - File path (string) or schedule ID (for backward compat)
 * @param {string|Object} idOrUpdates - Schedule ID (string) or updates (for backward compat)
 * @param {Object} [updates] - Updated schedule data (if first param is file path)
 * @returns {Object|null} Updated schedule or null if not found
 */
export function updateSchedule(filePathOrId, idOrUpdates, updates) {
  const filePath =
    typeof updates !== 'undefined' ? filePathOrId : DEFAULT_SCHEDULES_FILE
  const id = typeof updates !== 'undefined' ? idOrUpdates : filePathOrId
  const data = typeof updates !== 'undefined' ? updates : idOrUpdates

  const schedules = loadSchedules(filePath)
  const index = schedules.findIndex((s) => s.id === id)
  if (index === -1) {
    return null
  }
  schedules[index] = {
    ...schedules[index],
    ...data,
    id, // Preserve ID
    updatedAt: new Date().toISOString(),
  }
  saveSchedules(filePath, schedules)
  return schedules[index]
}

/**
 * Delete a schedule
 * @param {string} filePathOrId - File path (string) or schedule ID (for backward compat)
 * @param {string} [id] - Schedule ID (if first param is file path)
 * @returns {boolean} True if deleted, false if not found
 */
export function deleteSchedule(filePathOrId, id) {
  const filePath =
    typeof id === 'string' ? filePathOrId : DEFAULT_SCHEDULES_FILE
  const scheduleId = typeof id === 'string' ? id : filePathOrId

  const schedules = loadSchedules(filePath)
  const index = schedules.findIndex((s) => s.id === scheduleId)
  if (index === -1) {
    return false
  }
  schedules.splice(index, 1)
  saveSchedules(filePath, schedules)
  return true
}

/**
 * Generate a unique ID
 * @returns {string} Unique ID
 */
function generateId() {
  return `schedule_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
}
