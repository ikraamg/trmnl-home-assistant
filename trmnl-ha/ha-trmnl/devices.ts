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
 * Load device presets from devices.json
 */
export function loadPresets(): PresetsConfig {
  return presets as PresetsConfig
}
