/**
 * test/bundle-guard.test.ts — keep test files out of the Expo JS bundle.
 *
 * Metro builds its module graph from `app/`, and its default `blockList`
 * excludes nothing by name, so any `*.test.*` file dropped under `app/` gets
 * bundled into the release JS along with its `describe`/`expect` imports. The
 * app then dies at startup with an opaque transform error rather than the test
 * simply running — the failure surfaces far away from its cause.
 *
 * Root-level tests are outside Metro's graph and are safe, which is why
 * `app/index.test.tsx` had to move to `entry.test.tsx` before the Android
 * bundle would build. This is the guard that keeps it from drifting back.
 */

import { readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const APP_DIR = join(REPO_ROOT, 'app')
/** `foo.test.ts(x)`, `foo.spec.ts(x)`, and their `.mjs`/`.cjs` variants. */
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/

function findTestFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) findTestFiles(full, found)
    else if (TEST_FILE.test(entry.name)) found.push(relative(REPO_ROOT, full))
  }
  return found.sort()
}

describe('expo bundle', () => {
  it('keeps test files out of app/, which Metro ships inside the app bundle', () => {
    const offenders = findTestFiles(APP_DIR)
    const hint =
      'Metro bundles everything reachable from app/, so these run inside the ' +
      'release JS and break startup. Move them to the repo root:\n    ' +
      offenders.join('\n    ')
    expect(offenders, hint).toEqual([])
  })
})
