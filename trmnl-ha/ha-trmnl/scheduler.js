/**
 * Scheduler Module
 *
 * High-level orchestrator for automated screenshot capture on cron schedules.
 * Manages lifecycle, hot-reloads schedule changes, and delegates execution to specialized modules.
 *
 * Responsibilities:
 * 1. Lifecycle Management - start() initializes, stop() cleans up
 * 2. Hot-Reload - Periodic schedule file reload (every 60s by default)
 * 3. Cron Orchestration - Delegates to CronJobManager for job management
 * 4. Execution Delegation - Delegates to ScheduleExecutor for screenshot capture
 * 5. Manual Execution - "Send Now" API for on-demand screenshot triggers
 *
 * Hot-Reload Pattern:
 * Schedules stored in JSON file that can be edited while app runs.
 * Every SCHEDULER_RELOAD_INTERVAL_MS (60s), reloads file and syncs cron jobs.
 * Upsert/prune algorithm ensures cron jobs match current file state.
 *
 * Delegation Architecture:
 * Scheduler is thin orchestration layer - delegates real work to:
 * - CronJobManager: Manages node-cron job lifecycle
 * - ScheduleExecutor: Executes 5-command chain for screenshot capture
 *
 * Output Directory:
 * Creates and manages output directory for saved screenshots.
 * Directory path: {addon_root}/screenshots (configurable via const.js)
 *
 * Public API:
 * - start(): Begin scheduling (starts reload interval)
 * - stop(): Stop scheduling (clears interval, stops all jobs)
 * - executeNow(id): Manual execution for "Send Now" button in UI
 *
 * NOTE: Scheduler owns CronJobManager and ScheduleExecutor instances.
 * AI: When modifying reload logic, preserve upsert/prune synchronization pattern.
 *
 * @module scheduler
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadSchedules } from './lib/scheduleStore.js'
import { ScheduleExecutor } from './lib/scheduler/schedule-executor.js'
import { CronJobManager } from './lib/scheduler/cron-job-manager.js'
import {
  SCHEDULER_LOG_PREFIX,
  SCHEDULER_RELOAD_INTERVAL_MS,
  SCHEDULER_OUTPUT_DIR_NAME,
} from './const.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * High-level scheduler orchestrating cron jobs and screenshot execution.
 *
 * Architecture:
 * Thin orchestration layer that delegates to specialized modules.
 * Owns lifecycle of CronJobManager and ScheduleExecutor instances.
 *
 * Private Fields:
 * - #outputDir: Path to screenshots directory
 * - #cronManager: Cron job lifecycle manager
 * - #executor: Screenshot execution coordinator
 * - #reloadInterval: setInterval handle for periodic reload
 *
 * Lifecycle:
 * 1. Construction: Creates output dir, initializes managers
 * 2. start(): Loads schedules, starts reload interval
 * 3. (running): Periodic reload syncs cron jobs with schedule file
 * 4. stop(): Clears interval, stops all cron jobs
 *
 * Hot-Reload Mechanism:
 * setInterval fires every SCHEDULER_RELOAD_INTERVAL_MS calling #loadAndSchedule().
 * This enables zero-downtime schedule updates (edit JSON, changes apply within 60s).
 *
 * @class
 */
export class Scheduler {
  // Private fields
  #outputDir
  #cronManager
  #executor
  #reloadInterval

  /**
   * Creates scheduler instance with injected screenshot function.
   *
   * Dependency Injection:
   * screenshotFn is typically browser.takeScreenshot() from main.js.
   * Injected to enable testing without real browser.
   *
   * Output Directory Creation:
   * Creates screenshots directory if missing (recursive mkdir).
   * Happens at construction to fail fast if permissions wrong.
   *
   * @param {Function} screenshotFn - Screenshot capture function (async)
   */
  constructor(screenshotFn) {
    this.#outputDir = path.join(__dirname, SCHEDULER_OUTPUT_DIR_NAME)
    this.#cronManager = new CronJobManager()
    this.#executor = new ScheduleExecutor(screenshotFn, this.#outputDir)

    // Ensure output directory exists
    if (!fs.existsSync(this.#outputDir)) {
      fs.mkdirSync(this.#outputDir, { recursive: true })
    }
  }

  /**
   * Starts the scheduler with immediate load and periodic reload.
   *
   * Startup Sequence:
   * 1. Load schedules from file immediately (#loadAndSchedule)
   * 2. Create/update cron jobs for enabled schedules
   * 3. Start setInterval for periodic reload (every 60s)
   *
   * Hot-Reload Interval:
   * Reloads schedule file every SCHEDULER_RELOAD_INTERVAL_MS (60000ms).
   * Enables zero-downtime updates - edit schedules.json, changes apply within 60s.
   * No app restart required for schedule changes.
   *
   * Use Case:
   * Called once at app startup by main.js after browser initialization.
   * Should not be called multiple times without stop() in between.
   *
   * Idempotency:
   * Calling start() twice without stop() creates duplicate intervals.
   * Not idempotent - caller must ensure single invocation.
   *
   * @returns {void}
   */
  start() {
    console.log(`${SCHEDULER_LOG_PREFIX} Starting scheduler...`)
    this.#loadAndSchedule()

    // Reload schedules periodically
    this.#reloadInterval = setInterval(() => {
      this.#loadAndSchedule()
    }, SCHEDULER_RELOAD_INTERVAL_MS)
  }

  /**
   * Stops the scheduler and cleans up all cron jobs.
   *
   * Shutdown Sequence:
   * 1. Clear reload interval (stops periodic reloads)
   * 2. Stop all cron jobs via CronJobManager
   *
   * Cleanup:
   * All scheduled screenshots are cancelled - no more automatic captures.
   * Manual execution (executeNow) still works after stop().
   *
   * Use Case:
   * Called during graceful app shutdown or when disabling scheduler.
   *
   * Idempotency:
   * Safe to call multiple times - clearInterval() and stopAll() are idempotent.
   *
   * @returns {void}
   */
  stop() {
    console.log(`${SCHEDULER_LOG_PREFIX} Stopping scheduler...`)
    clearInterval(this.#reloadInterval)
    this.#cronManager.stopAll()
  }

  /**
   * Manually executes a schedule by ID, bypassing cron schedule.
   *
   * Use Case:
   * "Send Now" button in UI allows testing schedules without waiting for cron.
   * Also useful for debugging webhook issues or previewing screenshots.
   *
   * Behavior:
   * - Loads latest schedules from file (not cached)
   * - Executes regardless of schedule.enabled flag
   * - Uses same execution path as cron-triggered runs (ScheduleExecutor)
   * - Includes retry logic for network failures
   *
   * Error Handling:
   * - Throws if schedule ID not found (404 response from HTTP router)
   * - Bubbles up execution errors from ScheduleExecutor (500 response)
   *
   * Concurrency:
   * No locking - if cron fires same schedule simultaneously, both run.
   * Browser queue in main.js serializes execution to prevent conflicts.
   *
   * NOTE: This is the only public API besides start/stop.
   * AI: When modifying, preserve error propagation (don't swallow errors).
   *
   * @param {string} scheduleId - UUID of schedule to execute
   * @returns {Promise<Object>} Result with {success: true, savedPath: string}
   * @throws {Error} If schedule not found or execution fails
   */
  async executeNow(scheduleId) {
    const schedules = loadSchedules()
    const schedule = schedules.find((s) => s.id === scheduleId)

    if (!schedule) {
      throw new Error(`Schedule not found: ${scheduleId}`)
    }

    console.log(
      `${SCHEDULER_LOG_PREFIX} Manual execution requested: ${schedule.name}`
    )

    return await this.#executor.call(schedule)
  }

  /**
   * Loads schedules from file and synchronizes cron jobs (upsert/prune pattern).
   *
   * Upsert/Prune Algorithm:
   * 1. Load all schedules from schedules.json
   * 2. Track active IDs in Set for pruning later
   * 3. For each schedule:
   *    - If disabled: Remove cron job (if exists)
   *    - If enabled: Upsert cron job (create or update with fresh callback)
   * 4. Prune: Remove jobs whose IDs aren't in active set (deleted schedules)
   *
   * Hot-Reload Synchronization:
   * Called every 60s by reload interval + immediately on start().
   * Ensures cron jobs stay synchronized with schedule file contents.
   * Changes to schedules.json (add, edit, delete, enable/disable) apply within 60s.
   *
   * Upsert Strategy:
   * Always recreates cron jobs even for unchanged schedules.
   * Prevents stale closures (see CronJobManager docs for rationale).
   * Small performance cost (recreate ~5 jobs) but ensures data freshness.
   *
   * Disabled Schedule Handling:
   * Disabled schedules have jobs removed (not just paused).
   * Re-enabling creates fresh job with current schedule data.
   *
   * Logging:
   * Logs total count + details for each schedule (name, enabled, cron, webhook).
   * Helps debugging schedule loading issues and configuration errors.
   *
   * NOTE: Called frequently (every 60s) - keep performant.
   * AI: When modifying, preserve upsert-all + prune-orphans pattern.
   *
   * @private
   * @returns {void}
   */
  #loadAndSchedule() {
    const schedules = loadSchedules()
    const activeIds = new Set()

    console.log(
      `${SCHEDULER_LOG_PREFIX} Loaded ${schedules.length} schedule(s)`
    )

    for (const schedule of schedules) {
      console.log(
        `${SCHEDULER_LOG_PREFIX} Schedule: ${schedule.name}, enabled: ${
          schedule.enabled
        }, cron: ${schedule.cron}, webhook: ${schedule.webhook_url || 'none'}`
      )

      if (!schedule.enabled) {
        // Remove job if disabled
        this.#cronManager.removeJob(schedule.id, schedule.name)
        continue
      }

      activeIds.add(schedule.id)

      // Create/update cron job (delegates to CronJobManager)
      this.#cronManager.upsertJob(schedule, () => {
        this.#runSchedule(schedule)
      })
    }

    // Remove jobs for deleted schedules (delegates to CronJobManager)
    this.#cronManager.pruneInactiveJobs(activeIds)
  }

  /**
   * Executes a schedule via delegation to ScheduleExecutor (cron callback).
   *
   * Delegation Pattern:
   * Thin wrapper around ScheduleExecutor.call() - no logic here.
   * Exists to provide error swallowing for cron-triggered executions.
   *
   * Error Handling:
   * Catches and swallows all errors to prevent cron job crashes.
   * Errors already logged by ScheduleExecutor - no additional logging needed.
   * Cron jobs continue running even if individual executions fail.
   *
   * Difference from executeNow():
   * - #runSchedule: Swallows errors (cron keeps running)
   * - executeNow(): Propagates errors (HTTP response needs status code)
   *
   * Closure Capture:
   * This method is passed as cron callback in #loadAndSchedule().
   * Arrow function captures 'this' context correctly.
   * Schedule object captured in closure at job creation time.
   *
   * NOTE: Swallowing errors is intentional - cron resilience over strict failure.
   * AI: Don't add error re-throwing here - would crash cron jobs.
   *
   * @private
   * @param {Object} schedule - Schedule configuration to execute
   * @returns {Promise<void>} Always resolves (errors swallowed)
   */
  async #runSchedule(schedule) {
    try {
      await this.#executor.call(schedule)
    } catch (_err) {
      // Already logged by executor
    }
  }
}
