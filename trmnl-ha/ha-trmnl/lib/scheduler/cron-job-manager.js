/**
 * Cron Job Manager Module
 *
 * Manages lifecycle of cron jobs for scheduled screenshot capture and webhook delivery.
 * Wraps node-cron library with schedule-specific operations and stale data prevention.
 *
 * Responsibilities:
 * - Creating/updating cron jobs from schedule configurations
 * - Validating cron expressions before job creation
 * - Pruning jobs for deleted schedules
 * - Preventing stale data in closures via job recreation
 *
 * Stale Data Prevention:
 * Cron callbacks capture schedule data in closures. When schedules are updated
 * (new URL, new webhook, etc.), existing jobs would continue using OLD data.
 * Solution: Always stop + recreate jobs on upsert, ensuring fresh closures.
 *
 * Design Pattern:
 * Uses Map<scheduleId, cronJob> for O(1) lookups during updates/deletes.
 * Exposes read-only getters (jobs, jobCount) for monitoring/debugging.
 *
 * NOTE: This module is owned by Scheduler class - don't instantiate directly.
 * AI: When modifying upsertJob(), preserve the stop-before-recreate pattern.
 *
 * @module lib/scheduler/cron-job-manager
 */

import cron from 'node-cron'
import { SCHEDULER_LOG_PREFIX } from '../../const.js'

/**
 * Manages cron job lifecycle with automatic stale data prevention.
 *
 * Storage:
 * Maintains Map<scheduleId, cronJob> for fast lookups and updates.
 * Jobs are node-cron instances with custom cronExpression property.
 *
 * Lifecycle Methods:
 * - upsertJob(): Create or update (always recreates to avoid stale closures)
 * - removeJob(): Stop and remove single job
 * - pruneInactiveJobs(): Remove jobs not in active set (bulk cleanup)
 * - stopAll(): Shutdown all jobs (used during app shutdown)
 *
 * Read-Only Access:
 * Getters (jobs, jobCount) provide read-only access for monitoring.
 * Don't expose Map directly to prevent external mutation.
 *
 * @class
 */
export class CronJobManager {
  // Private fields
  #jobs = new Map()

  // Clean getters
  get jobs() {
    return this.#jobs
  }

  get jobCount() {
    return this.#jobs.size
  }

  /**
   * Creates or updates a cron job for a schedule (upsert operation).
   *
   * Stale Data Prevention:
   * ALWAYS stops existing job before creating new one, even on updates.
   * This ensures callback closures capture fresh schedule data (URL, webhook, etc.)
   * instead of stale references from previous job creation.
   *
   * Validation:
   * Validates cron expression syntax before job creation. Returns false if invalid,
   * preventing bad schedules from being added to the job map.
   *
   * Job Metadata:
   * Attaches cronExpression property to job for debugging/monitoring.
   * Useful for inspecting what schedule a job is running on.
   *
   * Error Handling:
   * Logs validation errors but doesn't throw - graceful degradation.
   * Caller should check return value to detect failures.
   *
   * NOTE: Called frequently during schedule reloads (every 60s by default).
   * Stop-then-recreate pattern is intentional despite reload frequency.
   * AI: Don't optimize away the stop() call - stale closure prevention is critical.
   *
   * @param {Object} schedule - Schedule object with id, name, cron expression
   * @param {Function} callback - Function to execute when cron fires
   * @returns {boolean} True if job was created/updated, false if validation failed
   */
  upsertJob(schedule, callback) {
    // Validate cron expression
    if (!cron.validate(schedule.cron)) {
      console.error(
        `${SCHEDULER_LOG_PREFIX} Invalid cron expression for ${schedule.name}: ${schedule.cron}`
      )
      return false
    }

    // Always stop existing job to ensure fresh callback with latest data
    // This prevents stale schedule data from being cached in closures
    const existingJob = this.#jobs.get(schedule.id)
    if (existingJob) {
      existingJob.stop()
    }

    // Create new job with fresh callback
    const job = cron.schedule(schedule.cron, callback)
    job.cronExpression = schedule.cron
    this.#jobs.set(schedule.id, job)

    console.log(
      `${SCHEDULER_LOG_PREFIX} Scheduled: ${schedule.name} (${schedule.cron})`
    )

    return true
  }

  /**
   * Removes a single cron job by schedule ID.
   *
   * Lifecycle:
   * 1. Stops the job (no more cron callbacks)
   * 2. Deletes from jobs Map
   * 3. Logs removal for debugging
   *
   * Idempotency:
   * Returns false if job doesn't exist (already removed or never created).
   * Safe to call multiple times with same ID.
   *
   * Logging:
   * Uses schedule name if provided, otherwise falls back to ID.
   * Helps correlate log messages with user-facing schedule names.
   *
   * @param {string} id - Schedule ID to remove
   * @param {string} [name] - Optional schedule name for better logging
   * @returns {boolean} True if job was removed, false if not found
   */
  removeJob(id, name) {
    const job = this.#jobs.get(id)
    if (job) {
      job.stop()
      this.#jobs.delete(id)
      const logName = name ? name : id
      console.log(`${SCHEDULER_LOG_PREFIX} Stopped job: ${logName}`)
      return true
    }
    return false
  }

  /**
   * Removes jobs for schedules that no longer exist (bulk cleanup).
   *
   * Use Case:
   * Called during schedule reloads to remove jobs for deleted schedules.
   * Prevents orphaned cron jobs from continuing to run after their
   * schedule configuration has been deleted.
   *
   * Algorithm:
   * Iterates jobs Map, stopping and deleting any job whose ID is NOT
   * in the activeIds set. Returns count of pruned jobs for monitoring.
   *
   * Frequency:
   * Called on every schedule reload (default: every 60 seconds).
   * Usually prunes 0 jobs (most reloads don't involve deletions).
   *
   * @param {Set<string>} activeIds - Set of currently active schedule IDs
   * @returns {number} Number of jobs pruned (stopped and removed)
   */
  pruneInactiveJobs(activeIds) {
    let prunedCount = 0
    for (const [id, job] of this.#jobs) {
      if (!activeIds.has(id)) {
        job.stop()
        this.#jobs.delete(id)
        console.log(
          `${SCHEDULER_LOG_PREFIX} Removed deleted schedule job: ${id}`
        )
        prunedCount++
      }
    }
    return prunedCount
  }

  /**
   * Stops all cron jobs and clears the jobs Map (shutdown operation).
   *
   * Use Case:
   * Called during graceful app shutdown or when completely resetting scheduler.
   * Ensures no orphaned cron jobs continue running after app stops.
   *
   * Algorithm:
   * Iterates all jobs, stops each one, then clears entire Map in one operation.
   * After this call, jobCount will be 0.
   *
   * NOTE: This is a destructive operation with no undo. Only use during shutdown.
   *
   * @returns {void}
   */
  stopAll() {
    for (const [_id, job] of this.#jobs) {
      job.stop()
    }
    this.#jobs.clear()
  }
}
