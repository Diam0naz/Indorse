/**
 * features/profile/types.ts — Setup wizard model
 *
 * Pure data + logic for the profile-driven setup wizard (`app/setup.tsx`)
 * and the "Complete your setup" banner on the Profile tab:
 *
 *   OperatorProfile  name / bio / photo the operator enters in step 1
 *   DeferredFlags    "skip for now" choices, persisted so a skipped step
 *                    still counts as handled on the banner
 *   validateProfile  step-1 form validation (English strings, like every
 *                    other feature validator, via lib/validation)
 *   setupProgress    derives the 4 banner signals from live state — there
 *                    is deliberately no `completedAt` flag, so the banner
 *                    can never lie about what is still missing
 *
 * The banner tracks profile / wallet / farm / access. The app-lock step is
 * intentionally excluded: it is a recommendation, not a setup blocker, and
 * AuthGate already owns that flow.
 */

import { errorOrNull, firstError, maxStringLength, requiredString } from '@/lib/validation'

/** Display identity saved by wizard step 1. */
export interface OperatorProfile {
  name: string
  bio: string
  /** Local file URI of the chosen avatar (copied to documentDirectory), or null. */
  photoUri: string | null
  /** Epoch ms of the last save — display only. */
  savedAt: number
}

/** Input accepted by `saveProfile` (savedAt is stamped by the provider). */
export interface ProfileInput {
  name: string
  bio: string
  photoUri: string | null
}

/** Which wizard steps the operator chose to defer ("Skip for now"). */
export interface DeferredFlags {
  wallet: boolean
  farm: boolean
  access: boolean
  lock: boolean
}

export type ProfileValidationError = { name?: string; bio?: string }

/** Name required (≤ 40), bio optional (≤ 160). English strings, per feature convention. */
export function validateProfile(input: ProfileInput): ProfileValidationError | null {
  const errors: ProfileValidationError = {
    name: firstError(requiredString(input.name, 'Name'), maxStringLength(input.name.trim(), 40, 'Name')),
    bio: maxStringLength(input.bio, 160, 'Bio'),
  }
  return errorOrNull(errors)
}

/** "Mae Hollenbeck" → "MH"; empty input → "". */
export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')
}

/** The four signals the Profile banner tracks (app-lock deliberately excluded). */
export type SetupSignalKey = 'profile' | 'wallet' | 'farm' | 'access'

export interface SetupSignals {
  profileSaved: boolean
  walletConnected: boolean
  farmRegistered: boolean
  accessGranted: boolean
  deferred: DeferredFlags
}

export interface SetupProgressItem {
  key: SetupSignalKey
  done: boolean
}

export interface SetupProgress {
  items: SetupProgressItem[]
  done: number
  total: number
  complete: boolean
}

/**
 * Fold live state (+ persisted deferrals) into banner progress.
 * A deferred step counts as handled — the operator made a choice.
 */
export function setupProgress(signals: SetupSignals): SetupProgress {
  const items: SetupProgressItem[] = [
    { key: 'profile', done: signals.profileSaved },
    { key: 'wallet', done: signals.walletConnected || signals.deferred.wallet },
    { key: 'farm', done: signals.farmRegistered || signals.deferred.farm },
    { key: 'access', done: signals.accessGranted || signals.deferred.access },
  ]
  const done = items.filter((item) => item.done).length
  return { items, done, total: items.length, complete: done === items.length }
}
