/**
 * Type-safe JSON serialization utilities.
 *
 * Prevents accidentally serializing Promises or other non-data types.
 *
 * @module lib/json
 */

/**
 * Serializable data - excludes Promises and functions at compile time.
 *
 * Uses a conditional type: if T extends Promise, it resolves to `never`,
 * causing a type error. Otherwise accepts the value as-is.
 */
type Serializable<T> = T extends Promise<unknown> ? never : T

/**
 * Type-safe JSON.stringify that rejects Promises at compile time.
 *
 * Standard JSON.stringify accepts `any`, so passing an un-awaited Promise
 * compiles fine but serializes to `{}`. This wrapper catches that mistake.
 *
 * @example
 * // Compile error - Promise resolves to 'never'
 * toJson(loadSchedules())
 *
 * // Works - awaited value is Schedule[]
 * toJson(await loadSchedules())
 */
export function toJson<T>(data: Serializable<T>): string {
  return JSON.stringify(data)
}
