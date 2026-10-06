/**
 * lib/display-name.ts — How a person is initialled
 *
 * The UI shows a real name when one exists (in full in the greeting —
 * "Good morning, Mae Hollenbeck"), the wallet's generated label otherwise,
 * and initialled avatars for both. `initialsOf` returns '' for empty input;
 * callers treat '' as "nothing to initial" and fall back to the person icon
 * instead of a placeholder letter.
 */

/** "Mae Hollenbeck" → "MH"; "Amber Falcon" → "AF". At most two letters. */
export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? '')
    .join('')
    .toUpperCase()
}
