/**
 * lib/greeting.ts — Time-of-day greeting
 *
 * The app header greets the operator by name instead of showing the brand word
 * and a raw pubkey. The greeting itself is a message key so it is translated by
 * the normal `t()` layer rather than assembled from fragments.
 *
 * Boundaries follow common usage:
 *   05:00–11:59  morning   "Good morning"
 *   12:00–17:59  afternoon "Good afternoon"
 *   18:00–04:59  evening   "Good evening"
 */

export type GreetingKey = 'header.greetMorning' | 'header.greetAfternoon' | 'header.greetEvening'

/**
 * Resolve the greeting key for a 24-hour hour value.
 *
 * The hour is a parameter (defaulting to the device clock) so the mapping is
 * testable without freezing time.
 */
export function greetingKey(hour: number = new Date().getHours()): GreetingKey {
  const h = ((hour % 24) + 24) % 24
  if (h >= 5 && h < 12) return 'header.greetMorning'
  if (h >= 12 && h < 18) return 'header.greetAfternoon'
  return 'header.greetEvening'
}
