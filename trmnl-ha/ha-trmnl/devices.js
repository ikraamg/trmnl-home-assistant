import presets from "./devices.json" with { type: "json" };

/**
 * Get device configurations (now returns presets)
 * @returns {Object} Schedule presets keyed by preset ID
 */
export function loadDevicesConfig() {
  return presets;
}

/**
 * Get schedule presets
 * @returns {Object} Schedule presets keyed by preset ID
 */
export function loadPresets() {
  return presets;
}
