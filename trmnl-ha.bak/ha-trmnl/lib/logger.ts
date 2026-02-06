/**
 * Logging infrastructure using LogTape
 * Provides structured, timestamped logging with module-specific categories
 * @module lib/logger
 */

import {
  configure,
  getConsoleSink,
  getLogger,
  type LogRecord,
} from '@logtape/logtape'
import { debugLogging } from '../const.js'

// =============================================================================
// CONFIGURATION
// =============================================================================

type LogLevel = 'trace' | 'debug' | 'info' | 'warning' | 'error' | 'fatal'

/**
 * Log level determined by:
 * 1. LOG_LEVEL env var (highest priority, for development override)
 * 2. debug_logging from HA add-on config (enables debug mode)
 * 3. Default: 'info'
 */
function getLogLevel(): LogLevel {
  const envLevel = process.env['LOG_LEVEL']
  if (envLevel) return envLevel as LogLevel

  return debugLogging ? 'debug' : 'info'
}

const LOG_LEVEL = getLogLevel()

/**
 * Root category for all loggers
 */
const ROOT_CATEGORY = 'ha-trmnl'

// =============================================================================
// CUSTOM FORMATTER
// =============================================================================

/**
 * Formats log records with ISO timestamps and colored level indicators
 * Format: [2025-12-30T10:15:30.123Z] [INFO] [category] message
 */
function formatLogRecord(record: LogRecord): readonly unknown[] {
  const timestamp = new Date(record.timestamp).toISOString()
  const level = record.level.toUpperCase().padEnd(5)
  const category = record.category.slice(1).join('.') || ROOT_CATEGORY

  // Build message from template parts
  let message = ''
  const values: unknown[] = []

  for (let i = 0; i < record.message.length; i++) {
    const part = record.message[i]
    if (i % 2 === 0) {
      // Even indices are string parts
      message += String(part)
    } else {
      // Odd indices are interpolated values
      if (typeof part === 'object' && part !== null) {
        message += '%o'
        values.push(part)
      } else {
        message += String(part)
      }
    }
  }

  return [`[${timestamp}] [${level}] [${category}] ${message}`, ...values]
}

// =============================================================================
// INITIALIZATION
// =============================================================================

let initialized = false

/**
 * Initialize the logging system
 * Must be called before using any loggers
 * Safe to call multiple times (no-op after first call)
 */
export async function initializeLogging(): Promise<void> {
  if (initialized) return

  await configure({
    sinks: {
      console: getConsoleSink({
        formatter: formatLogRecord,
      }),
    },
    loggers: [
      {
        category: [ROOT_CATEGORY],
        lowestLevel: LOG_LEVEL,
        sinks: ['console'],
      },
      // Silence LogTape meta logger info messages
      {
        category: ['logtape', 'meta'],
        lowestLevel: 'warning',
        sinks: ['console'],
      },
    ],
  })

  initialized = true
}

// =============================================================================
// LOGGER FACTORY
// =============================================================================

type LoggerCategory =
  | 'app'
  | 'browser'
  | 'screenshot'
  | 'dithering'
  | 'scheduler'
  | 'http'
  | 'ui'
  | 'config'
  | 'webhook'
  | 'cron'
  | 'navigation'

/**
 * Get a logger for a specific module category
 * Categories create hierarchical namespaces under the root 'ha-trmnl' category
 *
 * @param category - The module category (e.g., 'browser', 'scheduler')
 * @returns A Logger instance for the specified category
 *
 * @example
 * const log = getModuleLogger('browser')
 * log.info`Browser launched in ${ms}ms`
 * log.error`Failed to navigate: ${error.message}`
 */
export function getModuleLogger(category: LoggerCategory) {
  return getLogger([ROOT_CATEGORY, category])
}

// =============================================================================
// PRE-CONFIGURED LOGGERS (convenience exports)
// =============================================================================

/** Logger for main application lifecycle */
export const appLogger = () => getModuleLogger('app')

/** Logger for browser operations (Puppeteer) */
export const browserLogger = () => getModuleLogger('browser')

/** Logger for screenshot capture */
export const screenshotLogger = () => getModuleLogger('screenshot')

/** Logger for dithering/image processing */
export const ditheringLogger = () => getModuleLogger('dithering')

/** Logger for scheduler operations */
export const schedulerLogger = () => getModuleLogger('scheduler')

/** Logger for HTTP server/routing */
export const httpLogger = () => getModuleLogger('http')

/** Logger for UI operations */
export const uiLogger = () => getModuleLogger('ui')

/** Logger for configuration loading */
export const configLogger = () => getModuleLogger('config')

/** Logger for webhook delivery */
export const webhookLogger = () => getModuleLogger('webhook')

/** Logger for cron job management */
export const cronLogger = () => getModuleLogger('cron')

/** Logger for navigation commands */
export const navigationLogger = () => getModuleLogger('navigation')
