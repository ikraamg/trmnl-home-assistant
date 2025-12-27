/**
 * Integration tests for Schedule Store (lib/scheduleStore.js)
 *
 * Tests schedule CRUD operations with real file I/O.
 *
 * Testing Philosophy (from Alchemists.io):
 * - Integration tests use REAL file I/O (not mocked)
 * - Each test isolated with beforeEach/afterEach cleanup
 * - One expectation per test (consolidated with toMatchObject where appropriate)
 * - Explicit describe blocks for each operation
 *
 * @module tests/integration/schedule.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import {
  loadSchedules,
  getSchedule,
  createSchedule,
  updateSchedule,
  deleteSchedule,
} from '../../lib/scheduleStore.js'
import { existsSync, unlinkSync } from 'node:fs'

const TEST_SCHEDULE_FILE = './test-schedules.json'

describe('Schedule Store', () => {
  beforeEach(() => {
    // Clean slate: Remove test file before each test
    if (existsSync(TEST_SCHEDULE_FILE)) {
      unlinkSync(TEST_SCHEDULE_FILE)
    }
  })

  afterEach(() => {
    // Cleanup: Remove test file after each test
    if (existsSync(TEST_SCHEDULE_FILE)) {
      unlinkSync(TEST_SCHEDULE_FILE)
    }
  })

  // ==========================================================================
  // loadSchedules() - Load schedules from file
  // ==========================================================================

  describe('loadSchedules', () => {
    it('returns empty array when no file exists', async () => {
      const schedules = await loadSchedules(TEST_SCHEDULE_FILE)

      expect(schedules).toEqual([])
    })

    it('loads existing schedules from file', async () => {
      const _schedule1 = await createSchedule(TEST_SCHEDULE_FILE, {
        name: 'Schedule 1',
        path: '/lovelace/0',
        viewport: '800x480',
        cron: '0 * * * *',
      })

      const _schedule2 = await createSchedule(TEST_SCHEDULE_FILE, {
        name: 'Schedule 2',
        path: '/lovelace/1',
        viewport: '1024x768',
        cron: '0 */2 * * *',
      })

      const schedules = await loadSchedules(TEST_SCHEDULE_FILE)

      expect(schedules).toHaveLength(2)
      expect(schedules).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Schedule 1' }),
          expect.objectContaining({ name: 'Schedule 2' }),
        ])
      )
    })
  })

  // ==========================================================================
  // createSchedule() - Create new schedule with generated ID
  // ==========================================================================

  describe('createSchedule', () => {
    it('creates new schedule with generated ID', async () => {
      const schedule = await createSchedule(TEST_SCHEDULE_FILE, {
        name: 'Test Schedule',
        path: '/lovelace/0',
        viewport: '800x480',
        cron: '0 * * * *',
        webhook_url: 'https://example.com/webhook',
      })

      expect(schedule).toMatchObject({
        id: expect.any(String),
        name: 'Test Schedule',
        path: '/lovelace/0',
        viewport: '800x480',
        cron: '0 * * * *',
        webhook_url: 'https://example.com/webhook',
      })
    })

    it('generates unique IDs for concurrent creates', async () => {
      const schedule1 = await createSchedule(TEST_SCHEDULE_FILE, {
        name: 'Schedule 1',
        path: '/lovelace/0',
        viewport: '800x480',
        cron: '0 * * * *',
      })

      const schedule2 = await createSchedule(TEST_SCHEDULE_FILE, {
        name: 'Schedule 2',
        path: '/lovelace/1',
        viewport: '800x480',
        cron: '0 * * * *',
      })

      expect(schedule1.id).not.toBe(schedule2.id)
    })

    it('persists schedule to file', async () => {
      await createSchedule(TEST_SCHEDULE_FILE, {
        name: 'Persist Test',
        path: '/lovelace/0',
        viewport: '800x480',
        cron: '0 * * * *',
      })

      expect(existsSync(TEST_SCHEDULE_FILE)).toBe(true)

      const schedules = await loadSchedules(TEST_SCHEDULE_FILE)
      expect(schedules[0]).toMatchObject({ name: 'Persist Test' })
    })

    it('preserves all optional schedule properties', async () => {
      const schedule = await createSchedule(TEST_SCHEDULE_FILE, {
        name: 'Full Test',
        path: '/lovelace/0',
        viewport: '800x480',
        format: 'png',
        theme: 'dark',
        dark: true,
        zoom: 1.5,
        wait: 1000,
        lang: 'es',
        rotate: 90,
        cron: '0 * * * *',
        webhook_url: 'https://example.com/webhook',
        dithering: true,
        dither_method: 'floyd-steinberg',
        palette: 'gray-4',
      })

      expect(schedule).toMatchObject({
        format: 'png',
        theme: 'dark',
        dark: true,
        zoom: 1.5,
        wait: 1000,
        lang: 'es',
        rotate: 90,
        dithering: true,
        dither_method: 'floyd-steinberg',
        palette: 'gray-4',
      })
    })

    it('creates schedule with only required fields', async () => {
      const minimal = await createSchedule(TEST_SCHEDULE_FILE, {
        name: 'Minimal',
        path: '/lovelace/0',
        viewport: '800x480',
        cron: '0 * * * *',
      })

      expect(minimal).toMatchObject({
        name: 'Minimal',
        path: '/lovelace/0',
        viewport: '800x480',
        cron: '0 * * * *',
      })
      expect(minimal.webhook_url).toBeUndefined()
    })
  })

  // ==========================================================================
  // getSchedule() - Retrieve schedule by ID
  // ==========================================================================

  describe('getSchedule', () => {
    it('retrieves schedule by ID', async () => {
      const created = await createSchedule(TEST_SCHEDULE_FILE, {
        name: 'Get Test',
        path: '/lovelace/0',
        viewport: '800x480',
        cron: '0 * * * *',
      })

      const schedule = await getSchedule(TEST_SCHEDULE_FILE, created.id)

      expect(schedule).toEqual(created)
    })

    it('returns null for nonexistent ID', async () => {
      const schedule = await getSchedule(TEST_SCHEDULE_FILE, 'nonexistent-id')

      expect(schedule).toBeNull()
    })
  })

  // ==========================================================================
  // updateSchedule() - Update existing schedule
  // ==========================================================================

  describe('updateSchedule', () => {
    it('updates existing schedule fields', async () => {
      const created = await createSchedule(TEST_SCHEDULE_FILE, {
        name: 'Original Name',
        path: '/lovelace/0',
        viewport: '800x480',
        cron: '0 * * * *',
      })

      const updated = await updateSchedule(TEST_SCHEDULE_FILE, created.id, {
        name: 'Updated Name',
        path: '/lovelace/1',
        viewport: '1024x768',
        cron: '0 */2 * * *',
        webhook_url: 'https://example.com/webhook',
      })

      expect(updated).toMatchObject({
        id: created.id, // ID preserved
        name: 'Updated Name',
        path: '/lovelace/1',
        viewport: '1024x768',
        cron: '0 */2 * * *',
        webhook_url: 'https://example.com/webhook',
      })
    })

    it('persists updates to file', async () => {
      const created = await createSchedule(TEST_SCHEDULE_FILE, {
        name: 'Original',
        path: '/lovelace/0',
        viewport: '800x480',
        cron: '0 * * * *',
      })

      await updateSchedule(TEST_SCHEDULE_FILE, created.id, {
        name: 'Updated',
      })

      const schedules = await loadSchedules(TEST_SCHEDULE_FILE)
      expect(schedules[0]).toMatchObject({ name: 'Updated' })
    })

    it('returns null for nonexistent ID', async () => {
      const result = await updateSchedule(
        TEST_SCHEDULE_FILE,
        'nonexistent-id',
        { name: 'Updated' }
      )

      expect(result).toBeNull()
    })
  })

  // ==========================================================================
  // deleteSchedule() - Delete schedule by ID
  // ==========================================================================

  describe('deleteSchedule', () => {
    it('deletes existing schedule', async () => {
      const created = await createSchedule(TEST_SCHEDULE_FILE, {
        name: 'Delete Test',
        path: '/lovelace/0',
        viewport: '800x480',
        cron: '0 * * * *',
      })

      const success = await deleteSchedule(TEST_SCHEDULE_FILE, created.id)

      expect(success).toBe(true)
    })

    it('removes schedule from file', async () => {
      const created = await createSchedule(TEST_SCHEDULE_FILE, {
        name: 'Delete Persist Test',
        path: '/lovelace/0',
        viewport: '800x480',
        cron: '0 * * * *',
      })

      await deleteSchedule(TEST_SCHEDULE_FILE, created.id)

      const schedule = await getSchedule(TEST_SCHEDULE_FILE, created.id)
      expect(schedule).toBeNull()
    })

    it('returns false for nonexistent ID', async () => {
      const success = await deleteSchedule(TEST_SCHEDULE_FILE, 'nonexistent-id')

      expect(success).toBe(false)
    })
  })

  // ==========================================================================
  // Concurrent Access - File locking behavior
  // ==========================================================================

  describe('Concurrent Access', () => {
    it('handles multiple simultaneous creates', async () => {
      const promises = [
        createSchedule(TEST_SCHEDULE_FILE, {
          name: 'Schedule 1',
          path: '/lovelace/0',
          viewport: '800x480',
          cron: '0 * * * *',
        }),
        createSchedule(TEST_SCHEDULE_FILE, {
          name: 'Schedule 2',
          path: '/lovelace/1',
          viewport: '800x480',
          cron: '0 * * * *',
        }),
        createSchedule(TEST_SCHEDULE_FILE, {
          name: 'Schedule 3',
          path: '/lovelace/2',
          viewport: '800x480',
          cron: '0 * * * *',
        }),
      ]

      const schedules = await Promise.all(promises)

      expect(schedules).toHaveLength(3)

      const loaded = await loadSchedules(TEST_SCHEDULE_FILE)
      expect(loaded).toHaveLength(3)
    })
  })
})
