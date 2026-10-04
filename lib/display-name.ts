/**
 * lib/display-name.ts — How a person is addressed and initialled
 *
 * The UI shows a real name when one exists (first-name basis in the
 * greeting — "Good morning, Mae"), the wallet's generated label otherwise,
 * and initialled avatars for both. `initialsOf` returns '' for empty input;
 * callers treat '' as "nothing to initial" and fall back to the person icon
 * instead of a placeholder letter.
 */

/** "Mae Hollenbeck" → "Mae" — the socially friendly form for a greeting. */
export function firstNameOf(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? ''
}

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
