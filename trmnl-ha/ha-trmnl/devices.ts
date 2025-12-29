/**
 * Device Configuration Module
 *
 * Loads TRMNL device presets from devices.json
 *
 * @module devices
 */

import presets from './devices.json' with { type: 'json' }
import type { PresetsConfig } from './types/domain.js'

/**
 * Get device configurations (returns presets)
 */
export function loadDevicesConfig(): PresetsConfig {
  return presets as PresetsConfig
}

/**
 * Get schedule presets
 */
export function loadPresets(): PresetsConfig {
  return presets as PresetsConfig
}
