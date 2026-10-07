/**
 * test/eas-guard.test.ts — keep the cloud build config honest.
 *
 * EAS profiles are read by the EAS build service, not by any local gate, so a
 * wrong value here only surfaces after a paid build — or, for
 * `EXPO_PUBLIC_FORCE_SEEKER`, after it has already shipped on a device. Two
 * rules are worth failing cheaply on:
 *
 *   1. FORCE_SEEKER must be pinned *explicitly* to a non-"true" value in every
 *      profile. Pinning rather than merely "not setting it" matters: an
 *      unset flag is safe today only because `lib/seeker.ts` defaults to false,
 *      which is invisible from eas.json. A profile added next month should have
 *      to carry the pin consciously instead of inheriting silence.
 *   2. Android build types. Play accepts an AAB for the store, and an AAB
 *      cannot be sideloaded; a dev/preview build shares an APK. Getting this
 *      backwards fails at the far end of the upload or the install, far from
 *      the file that caused it.
 *
 * This is a structural guard, so it parses the JSON directly. Full schema
 * validation (unknown keys, enum ranges) belongs to `@expo/eas-json`, which is
 * what `eas build` itself runs — see _Release builds (EAS)_ in the README.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

interface EasProfile {
  developmentClient?: boolean
  env?: Record<string, string | undefined>
  android?: { buildType?: string }
}

function readEas(): { build?: Record<string, EasProfile> } {
  const raw = readFileSync(`${REPO_ROOT}/eas.json`, 'utf8')
  return JSON.parse(raw) as { build?: Record<string, EasProfile> }
}

describe('eas.json', () => {
  it('parses as JSON', () => {
    expect(() => readEas()).not.toThrow()
  })

  it('pins EXPO_PUBLIC_FORCE_SEEKER to a non-"true" value in every build profile', () => {
    const build = readEas().build ?? {}
    expect(Object.keys(build).length).toBeGreaterThan(0)

    const offenders = Object.entries(build)
      .filter(([, profile]) => profile.env?.EXPO_PUBLIC_FORCE_SEEKER !== 'false')
      .map(([name, profile]) => `  ${name}: ${JSON.stringify(profile.env?.EXPO_PUBLIC_FORCE_SEEKER)}`)

    expect(
      offenders,
      'EXPO_PUBLIC_FORCE_SEEKER fakes Seeker device identity for previews and must ' +
        'never ship. Every profile pins it to "false" explicitly — a profile with the ' +
        'key missing is not protected by this guard:\n' +
        offenders.join('\n'),
    ).toEqual([])
  })

  it('builds an AAB for the store and APKs for anything sideloaded', () => {
    const build = readEas().build ?? {}

    for (const [name, profile] of Object.entries(build)) {
      const buildType = profile.android?.buildType
      if (name === 'production') {
        expect(buildType, `production must be an AAB — Play does not accept an APK`).toBe('app-bundle')
      } else {
        expect(
          buildType,
          `${name} must be an APK — an AAB cannot be sideloaded, so an internal ` +
            `distribution profile built as app-bundle is uninstallable`,
        ).toBe('apk')
      }
    }
  })
})
