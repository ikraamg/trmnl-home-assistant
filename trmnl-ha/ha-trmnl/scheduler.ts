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
 * NOTE: Scheduler owns CronJobManager and ScheduleExecutor instances.
 * NOTE: When modifying reload logic, preserve upsert/prune synchronization pattern.
 *
 * @module scheduler
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadSchedules } from './lib/scheduleStore.js'
import { ScheduleExecutor, type ScreenshotFunction, type ExecutionResult } from './lib/scheduler/schedule-executor.js'
import { CronJobManager } from './lib/scheduler/cron-job-manager.js'
import {
  SCHEDULER_LOG_PREFIX,
  SCHEDULER_RELOAD_INTERVAL_MS,
  SCHEDULER_OUTPUT_DIR_NAME,
} from './const.js'
import type { Schedule } from './types/domain.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * High-level scheduler orchestrating cron jobs and screenshot execution.
 */
export class Scheduler {
  #outputDir: string
  #cronManager: CronJobManager
  #executor: ScheduleExecutor
  #reloadInterval: ReturnType<typeof setInterval> | undefined

  /**
   * Creates scheduler instance with injected screenshot function.
   *
   * @param screenshotFn - Screenshot capture function (async)
   */
  constructor(screenshotFn: ScreenshotFunction) {
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
   */
  start(): void {
    console.log(`${SCHEDULER_LOG_PREFIX} Starting scheduler...`)
    // Fire-and-forget initial load (errors logged by loadAndSchedule)
    void this.#loadAndSchedule()

    // Reload schedules periodically
    this.#reloadInterval = setInterval(() => {
      void this.#loadAndSchedule()
    }, SCHEDULER_RELOAD_INTERVAL_MS)
  }

  /**
   * Stops the scheduler and cleans up all cron jobs.
   */
  stop(): void {
    console.log(`${SCHEDULER_LOG_PREFIX} Stopping scheduler...`)
    clearInterval(this.#reloadInterval)
    this.#cronManager.stopAll()
  }

  /**
   * Manually executes a schedule by ID, bypassing cron schedule.
   *
   * @param scheduleId - UUID of schedule to execute
   * @returns Result with success status and saved path
   * @throws Error if schedule not found or execution fails
   */
  async executeNow(scheduleId: string): Promise<ExecutionResult> {
    const schedules = await loadSchedules()
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
   */
  async #loadAndSchedule(): Promise<void> {
    const schedules = await loadSchedules()
    const activeIds = new Set<string>()

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
   */
  async #runSchedule(schedule: Schedule): Promise<void> {
    try {
      await this.#executor.call(schedule)
    } catch (_err) {
      // Already logged by executor
    }
  }
}
