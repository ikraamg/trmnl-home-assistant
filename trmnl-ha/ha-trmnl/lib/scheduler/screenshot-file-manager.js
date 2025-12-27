/**
 * Screenshot File Manager Module
 *
 * Provides file system operations for screenshot persistence and retention management.
 * Implements two commands following the Command Pattern.
 *
 * Commands:
 * 1. SaveScreenshotCommand - Persists screenshot buffer to timestamped file
 * 2. CleanupOldScreenshotsCommand - LRU deletion to enforce retention limits
 *
 * Filename Strategy:
 * Filenames use pattern: "{schedule_name}_{ISO_timestamp}.{format}"
 * Timestamps ensure uniqueness and enable chronological sorting.
 * Schedule names are sanitized (non-alphanumeric → underscore).
 *
 * Retention Strategy (LRU):
 * Cleanup uses Least Recently Used algorithm based on file modification time.
 * Oldest files deleted first when directory exceeds maxFiles limit.
 * Prevents unbounded disk growth from long-running schedules.
 *
 * Error Handling:
 * Save operations throw errors (critical path - must succeed).
 * Cleanup operations return error in result object (non-critical, graceful).
 *
 * Design Pattern:
 * Both commands use .call() method for consistent execution interface.
 * No shared state between command instances (pure functional style).
 *
 * NOTE: Commands are instantiated per-execution, not reused.
 * AI: When modifying cleanup, preserve mtime-based LRU sorting.
 *
 * @module lib/scheduler/screenshot-file-manager
 */

import fs from 'node:fs'
import path from 'node:path'

/**
 * Command for saving screenshot buffers to disk with timestamped filenames.
 *
 * Filename Generation:
 * Creates unique filenames combining schedule name and ISO timestamp.
 * Format: "{sanitized_name}_{timestamp}.{format}"
 * Example: "Kitchen_Dashboard_2025-01-15T10-30-45-123Z.png"
 *
 * Sanitization:
 * Schedule names can contain spaces, special chars, emojis, etc.
 * Regex /[^a-zA-Z0-9]/g replaces all non-alphanumeric chars with underscore.
 *
 * Timestamp Format:
 * ISO 8601 with colons and dots replaced by hyphens for filesystem safety.
 * Original: "2025-01-15T10:30:45.123Z"
 * Sanitized: "2025-01-15T10-30-45-123Z"
 *
 * Error Handling:
 * Throws on write failures (ENOSPC, EACCES, etc.) - caller must handle.
 * Critical operation - must succeed for schedule execution to succeed.
 *
 * @class
 */
export class SaveScreenshotCommand {
  #outputDir
  #schedule
  #imageBuffer
  #format

  /**
   * Creates save command instance.
   *
   * @param {string} outputDir - Directory to save file (must exist)
   * @param {Object} schedule - Schedule object with name property
   * @param {Buffer} imageBuffer - Screenshot image data
   * @param {string} format - File extension (png, jpeg, bmp)
   */
  constructor(outputDir, schedule, imageBuffer, format) {
    this.#outputDir = outputDir
    this.#schedule = schedule
    this.#imageBuffer = imageBuffer
    this.#format = format
  }

  /**
   * Saves screenshot to disk with timestamped filename.
   *
   * Algorithm:
   * 1. Generate ISO timestamp with colons/dots → hyphens
   * 2. Sanitize schedule name (alphanumeric + underscores only)
   * 3. Combine into filename: "{name}_{timestamp}.{ext}"
   * 4. Write buffer to file synchronously
   * 5. Return output path and filename
   *
   * Synchronous I/O:
   * Uses fs.writeFileSync for simplicity (already in async context).
   * File writes are fast (<10ms typically) so blocking is acceptable.
   *
   * Path Safety:
   * Uses path.join() to ensure correct path separators across platforms.
   *
   * @returns {Object} Result with {outputPath: string, filename: string}
   * @throws {Error} On file system errors (disk full, permissions, etc.)
   */
  call() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `${this.#schedule.name.replace(
      /[^a-zA-Z0-9]/g,
      '_'
    )}_${timestamp}.${this.#format}`
    const outputPath = path.join(this.#outputDir, filename)

    fs.writeFileSync(outputPath, this.#imageBuffer)

    return { outputPath, filename }
  }
}

/**
 * Command for LRU-based cleanup of old screenshot files.
 *
 * LRU Algorithm (Least Recently Used):
 * Deletes oldest files first when directory exceeds maxFiles limit.
 * "Age" determined by file modification time (mtime), not filename timestamp.
 * This ensures correct ordering even if system clock changes.
 *
 * Retention Calculation:
 * Typically maxFiles = (enabled schedules count) × RETENTION_MULTIPLIER
 * Example: 5 schedules × 3 multiplier = keep newest 15 files total
 *
 * File Selection:
 * Regex pattern filters for image files only (png, jpeg, jpg, bmp).
 * Other files in directory (logs, configs, etc.) are ignored.
 * Case-insensitive matching for Windows compatibility.
 *
 * Error Handling:
 * Returns error in result object instead of throwing (graceful degradation).
 * Cleanup is non-critical - better to continue without cleanup than fail run.
 *
 * Performance:
 * Reads entire directory + stats all files on each run.
 * Typical directories have <100 files, so this is fast (<10ms).
 * If directory grows large (>1000 files), consider optimization.
 *
 * @class
 */
export class CleanupOldScreenshotsCommand {
  #outputDir
  #maxFiles
  #filePattern

  /**
   * Creates cleanup command instance.
   *
   * @param {string} outputDir - Directory to clean up
   * @param {number} maxFiles - Maximum files to retain (delete oldest beyond this)
   * @param {RegExp} [filePattern=/\.(png|jpeg|jpg|bmp)$/i] - Regex to match image files
   */
  constructor(outputDir, maxFiles, filePattern = /\.(png|jpeg|jpg|bmp)$/i) {
    this.#outputDir = outputDir
    this.#maxFiles = maxFiles
    this.#filePattern = filePattern
  }

  /**
   * Executes LRU cleanup by deleting oldest files beyond retention limit.
   *
   * Algorithm:
   * 1. Read directory and filter for image files (regex match)
   * 2. stat() each file to get mtime (modification timestamp)
   * 3. Sort by mtime ascending (oldest first)
   * 4. Calculate excess: totalFiles - maxFiles
   * 5. Delete first N files (oldest) to reach limit
   * 6. Return statistics for logging/monitoring
   *
   * Sorting Strategy:
   * Uses mtime (modification time) instead of filename timestamp.
   * More robust - handles clock changes, manual file edits, etc.
   * Array.sort() with numeric comparison (a.mtime - b.mtime).
   *
   * Edge Cases:
   * - totalFiles ≤ maxFiles: No deletion, returns empty array
   * - Directory doesn't exist: Caught by try/catch, returns error
   * - No matching files: Returns empty result
   *
   * Synchronous I/O:
   * Uses sync fs operations for simplicity (fast for small directories).
   * readdirSync, statSync, unlinkSync all complete in <1ms per file.
   *
   * Error Handling:
   * Try/catch wraps entire operation to prevent cleanup failures from
   * crashing schedule execution. Returns error in result object.
   *
   * NOTE: Doesn't verify file deletions succeeded - assumes unlinkSync works.
   * AI: When optimizing, preserve mtime-based sorting (don't use filename).
   *
   * @returns {Object} Result with {totalFiles, deletedCount, deletedFiles[], error?}
   */
  call() {
    try {
      // Get all image files sorted by modification time
      const files = fs
        .readdirSync(this.#outputDir)
        .filter((f) => f.match(this.#filePattern))
        .map((f) => ({
          name: f,
          path: path.join(this.#outputDir, f),
          mtime: fs.statSync(path.join(this.#outputDir, f)).mtime,
        }))
        .sort((a, b) => a.mtime - b.mtime) // Oldest first

      // Delete oldest files if we exceed limit
      const filesToDelete = files.length - this.#maxFiles
      const deletedFiles = []

      if (filesToDelete > 0) {
        for (let i = 0; i < filesToDelete; i++) {
          fs.unlinkSync(files[i].path)
          deletedFiles.push(files[i].name)
        }
      }

      return {
        totalFiles: files.length,
        deletedCount: deletedFiles.length,
        deletedFiles,
      }
    } catch (err) {
      // Return empty result on error (logged by caller)
      return { totalFiles: 0, deletedCount: 0, deletedFiles: [], error: err.message }
    }
  }
}
