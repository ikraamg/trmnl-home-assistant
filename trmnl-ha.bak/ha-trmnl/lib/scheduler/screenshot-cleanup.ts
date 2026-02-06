/**
 * Screenshot Cleanup - LRU-based retention management
 *
 * Stateless service with single options object parameter.
 *
 * @module lib/scheduler/screenshot-cleanup
 */

import fs from 'node:fs'
import path from 'node:path'

/** Options for cleanup operation */
export interface CleanupOptions {
  outputDir: string
  maxFiles: number
  filePattern?: RegExp
}

/** Result from cleanup operation */
export interface CleanupResult {
  totalFiles: number
  deletedCount: number
  deletedFiles: string[]
  error?: string
}

/** File metadata for sorting */
interface FileWithMtime {
  name: string
  path: string
  mtime: Date
}

/**
 * Cleans up old screenshots using LRU deletion.
 * Keeps newest files, deletes oldest beyond retention limit.
 *
 * @param options - Cleanup options
 * @returns Result with cleanup statistics
 */
export function cleanupOldScreenshots(options: CleanupOptions): CleanupResult {
  const { outputDir, maxFiles, filePattern = /\.(png|jpeg|jpg|bmp)$/i } = options

  try {
    const files = getFilesWithMtime(outputDir, filePattern)
    const filesToDelete = files.length - maxFiles
    const deletedFiles: string[] = []

    if (filesToDelete > 0) {
      for (let i = 0; i < filesToDelete; i++) {
        fs.unlinkSync(files[i]!.path)
        deletedFiles.push(files[i]!.name)
      }
    }

    return { totalFiles: files.length, deletedCount: deletedFiles.length, deletedFiles }
  } catch (err) {
    return { totalFiles: 0, deletedCount: 0, deletedFiles: [], error: (err as Error).message }
  }
}

/** Gets files sorted by modification time (oldest first) */
function getFilesWithMtime(dir: string, pattern: RegExp): FileWithMtime[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.match(pattern))
    .map((f) => ({
      name: f,
      path: path.join(dir, f),
      mtime: fs.statSync(path.join(dir, f)).mtime,
    }))
    .sort((a, b) => a.mtime.getTime() - b.mtime.getTime())
}
