/**
 * Screenshot Saver - Persists screenshot buffers to disk
 *
 * Stateless service with single options object parameter.
 *
 * @module lib/scheduler/screenshot-saver
 */

import fs from 'node:fs'
import path from 'node:path'
import type { ImageFormat } from '../../types/domain.js'

/** Options for saving screenshot */
export interface SaveScreenshotOptions {
  outputDir: string
  scheduleName: string
  imageBuffer: Buffer
  format: ImageFormat
}

/** Result from save operation */
export interface SaveResult {
  outputPath: string
  filename: string
}

/**
 * Saves screenshot to disk with timestamped filename.
 *
 * @param options - Save options
 * @returns Result with outputPath and filename
 */
export function saveScreenshot(options: SaveScreenshotOptions): SaveResult {
  const { outputDir, scheduleName, imageBuffer, format } = options

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const safeName = scheduleName.replace(/[^a-zA-Z0-9]/g, '_')
  const filename = `${safeName}_${timestamp}.${format}`
  const outputPath = path.join(outputDir, filename)

  fs.writeFileSync(outputPath, imageBuffer)

  return { outputPath, filename }
}
