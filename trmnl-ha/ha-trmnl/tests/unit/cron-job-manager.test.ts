/**
 * Unit tests for CronJobManager
 *
 * Tests cron job lifecycle management with mock callbacks.
 *
 * @module tests/unit/cron-job-manager
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { CronJobManager } from '../../lib/scheduler/cron-job-manager.js'

describe('CronJobManager', () => {
  let manager: CronJobManager

  beforeEach(() => {
    manager = new CronJobManager()
  })

  afterEach(() => {
    manager.stopAll()
  })

  // ==========================================================================
  // upsertJob() - Create or update cron jobs
  // ==========================================================================

  describe('upsertJob', () => {
    it('creates new job for valid cron expression', () => {
      const result = manager.upsertJob(
        { id: 'test-1', name: 'Test Job', cron: '* * * * *' },
        () => {}
      )

      expect(result).toBe(true)
      expect(manager.jobCount).toBe(1)
    })

    it('returns false for invalid cron expression', () => {
      const result = manager.upsertJob(
        { id: 'test-1', name: 'Test Job', cron: 'invalid' },
        () => {}
      )

      expect(result).toBe(false)
      expect(manager.jobCount).toBe(0)
    })

    it('replaces existing job when ID already exists', () => {
      manager.upsertJob(
        { id: 'test-1', name: 'Old Job', cron: '* * * * *' },
        () => {}
      )
      manager.upsertJob(
        { id: 'test-1', name: 'New Job', cron: '*/5 * * * *' },
        () => {}
      )

      expect(manager.jobCount).toBe(1)
    })

    it('stores cronExpression on job for comparison', () => {
      manager.upsertJob(
        { id: 'test-1', name: 'Test', cron: '*/10 * * * *' },
        () => {}
      )

      const job = manager.jobs.get('test-1')

      expect(job?.cronExpression).toBe('*/10 * * * *')
    })

    it('handles multiple independent jobs', () => {
      manager.upsertJob(
        { id: 'job-1', name: 'Job 1', cron: '* * * * *' },
        () => {}
      )
      manager.upsertJob(
        { id: 'job-2', name: 'Job 2', cron: '*/5 * * * *' },
        () => {}
      )
      manager.upsertJob(
        { id: 'job-3', name: 'Job 3', cron: '0 * * * *' },
        () => {}
      )

      expect(manager.jobCount).toBe(3)
    })
  })

  // ==========================================================================
  // removeJob() - Stop and remove single job
  // ==========================================================================

  describe('removeJob', () => {
    it('removes existing job', () => {
      manager.upsertJob(
        { id: 'test-1', name: 'Test', cron: '* * * * *' },
        () => {}
      )

      const result = manager.removeJob('test-1')

      expect(result).toBe(true)
      expect(manager.jobCount).toBe(0)
    })

    it('returns false for non-existent job', () => {
      const result = manager.removeJob('non-existent')

      expect(result).toBe(false)
    })

    it('stops job before removing', () => {
      manager.upsertJob(
        { id: 'test-1', name: 'Test', cron: '* * * * *' },
        () => {}
      )
      manager.removeJob('test-1')

      // Job should be stopped (no way to verify directly, but no error thrown)
      expect(manager.jobs.has('test-1')).toBe(false)
    })

    it('accepts optional name for logging', () => {
      manager.upsertJob(
        { id: 'test-1', name: 'Named Job', cron: '* * * * *' },
        () => {}
      )

      const result = manager.removeJob('test-1', 'Named Job')

      expect(result).toBe(true)
    })
  })

  // ==========================================================================
  // pruneInactiveJobs() - Bulk cleanup of deleted schedules
  // ==========================================================================

  describe('pruneInactiveJobs', () => {
    it('removes jobs not in activeIds set', () => {
      manager.upsertJob(
        { id: 'keep-1', name: 'Keep 1', cron: '* * * * *' },
        () => {}
      )
      manager.upsertJob(
        { id: 'keep-2', name: 'Keep 2', cron: '* * * * *' },
        () => {}
      )
      manager.upsertJob(
        { id: 'delete-1', name: 'Delete 1', cron: '* * * * *' },
        () => {}
      )

      const pruned = manager.pruneInactiveJobs(new Set(['keep-1', 'keep-2']))

      expect(pruned).toBe(1)
      expect(manager.jobCount).toBe(2)
      expect(manager.jobs.has('delete-1')).toBe(false)
    })

    it('returns 0 when all jobs are active', () => {
      manager.upsertJob(
        { id: 'job-1', name: 'Job 1', cron: '* * * * *' },
        () => {}
      )
      manager.upsertJob(
        { id: 'job-2', name: 'Job 2', cron: '* * * * *' },
        () => {}
      )

      const pruned = manager.pruneInactiveJobs(new Set(['job-1', 'job-2']))

      expect(pruned).toBe(0)
      expect(manager.jobCount).toBe(2)
    })

    it('removes all jobs when activeIds is empty', () => {
      manager.upsertJob(
        { id: 'job-1', name: 'Job 1', cron: '* * * * *' },
        () => {}
      )
      manager.upsertJob(
        { id: 'job-2', name: 'Job 2', cron: '* * * * *' },
        () => {}
      )

      const pruned = manager.pruneInactiveJobs(new Set())

      expect(pruned).toBe(2)
      expect(manager.jobCount).toBe(0)
    })
  })

  // ==========================================================================
  // stopAll() - Shutdown all jobs
  // ==========================================================================

  describe('stopAll', () => {
    it('clears all jobs', () => {
      manager.upsertJob(
        { id: 'job-1', name: 'Job 1', cron: '* * * * *' },
        () => {}
      )
      manager.upsertJob(
        { id: 'job-2', name: 'Job 2', cron: '* * * * *' },
        () => {}
      )

      manager.stopAll()

      expect(manager.jobCount).toBe(0)
    })

    it('handles empty job list', () => {
      manager.stopAll()

      expect(manager.jobCount).toBe(0)
    })
  })

  // ==========================================================================
  // jobs getter - Access to internal job map
  // ==========================================================================

  describe('jobs getter', () => {
    it('returns Map of jobs', () => {
      manager.upsertJob(
        { id: 'test-1', name: 'Test', cron: '* * * * *' },
        () => {}
      )

      const jobs = manager.jobs

      expect(jobs).toBeInstanceOf(Map)
      expect(jobs.size).toBe(1)
    })
  })

  // ==========================================================================
  // Cron Expression Validation
  // ==========================================================================

  describe('Cron Expression Validation', () => {
    it('accepts standard 5-field cron expression', () => {
      const result = manager.upsertJob(
        { id: 'test', name: 'Test', cron: '0 9 * * 1-5' },
        () => {}
      )

      expect(result).toBe(true)
    })

    it('accepts 6-field cron expression with seconds', () => {
      const result = manager.upsertJob(
        { id: 'test', name: 'Test', cron: '*/10 * * * * *' },
        () => {}
      )

      expect(result).toBe(true)
    })

    it('rejects invalid day-of-week', () => {
      const result = manager.upsertJob(
        { id: 'test', name: 'Test', cron: '0 0 * * 8' },
        () => {}
      )

      expect(result).toBe(false)
    })

    it('rejects invalid hour', () => {
      const result = manager.upsertJob(
        { id: 'test', name: 'Test', cron: '0 25 * * *' },
        () => {}
      )

      expect(result).toBe(false)
    })
  })
})
