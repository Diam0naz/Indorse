/**
 * lib/seeker.ts — Seeker device detection (presentation-grade only)
 *
 * Solana Mobile's documented client-side check: a Seeker reports
 * `Platform.constants.Model === "Seeker"` (docs.solanamobile.com —
 * "Detecting Seeker users"). Those constants are spoofable, so this is only
 * ever used to decide *presentation* — the "Seed Vault secured" badge and the
 * Seeker-exclusive theme. Anything that grants an entitlement must go through
 * server-side Sign-in-with-Solana + SGT verification instead; a boolean from
 * this file is worthless as a security decision and is never used as one.
 *
 * `EXPO_PUBLIC_FORCE_SEEKER=true` previews the Seeker treatments on any
 * device (development and demos — never ship it enabled).
 */

import { Platform } from 'react-native'

/** The value `Platform.constants.Model` carries on a Seeker. */
export const SEEKER_MODEL = 'Seeker'

/** True when the dev/demo override asks us to pretend this is a Seeker. */
export function seekerForced(): boolean {
  return process.env.EXPO_PUBLIC_FORCE_SEEKER === 'true'
}

/**
 * Pure model comparison so both branches are unit-testable without a Seeker:
 * `forced` short-circuits (any device previews as one), otherwise the model
 * name has to be exactly `Seeker`.
 */
export function isSeekerModel(model: string | undefined, forced: boolean = seekerForced()): boolean {
  return forced || model === SEEKER_MODEL
}

/** Whether this app is running on a Seeker device. Presentation only. */
export function isSeekerDevice(): boolean {
  // `Platform` is a union of per-OS shapes and `Model` is Android-only, so
  // widen the constants struct rather than reach for a platform branch.
  const constants = Platform.constants as { Model?: string } | undefined
  return isSeekerModel(constants?.Model)
}
