/**
 * features/scout/evidence.test.ts — durable local evidence
 *
 * The file system is faked at the module boundary: `expo-file-system` has no
 * native side behind it under vitest, and the whole point of the module is
 * that it degrades instead of crashing when that happens (the unmocked
 * degradation path itself is pinned by camera-overlay-verdict.test.tsx,
 * which asserts cache URIs survive an environment where the module is
 * unavailable).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Crypto from 'expo-crypto'

vi.mock('expo-file-system', () => {
  // In-memory stand-ins. The constructor mirrors the real API's segment
  // joining: strings and Directory/File instances all contribute segments.
  const files = new Map<string, string>()
  const state = { dirExists: false, failCreateDir: false, failWrite: false }

  type Segment = string | { uris: string[] }
  const join = (...segments: Segment[]): string[] =>
    segments.flatMap((segment) => (typeof segment === 'string' ? [segment] : segment.uris))

  class FakeDirectory {
    uris: string[]
    constructor(...segments: Segment[]) {
      this.uris = join(...segments)
    }
    get uri(): string {
      return this.uris.join('/')
    }
    get exists(): boolean {
      return state.dirExists
    }
    create(): void {
      if (state.failCreateDir) throw new Error('EACCES: cannot create evidence directory')
      state.dirExists = true
    }
    delete(): void {
      state.dirExists = false
      files.clear()
    }
  }

  class FakeFile {
    uris: string[]
    constructor(...segments: Segment[]) {
      this.uris = join(...segments)
    }
    get uri(): string {
      return this.uris.join('/')
    }
    get exists(): boolean {
      return files.has(this.uri)
    }
    create(): void {
      if (files.has(this.uri)) throw new Error('EEXIST: file already exists')
      files.set(this.uri, '')
    }
    write(content: string): void {
      if (state.failWrite) throw new Error('ENOSPC: no space left on device')
      files.set(this.uri, content)
    }
    delete(): void {
      files.delete(this.uri)
    }
  }

  const document = { uris: ['file:///data/user/0/host.app/files'] }
  return { Directory: FakeDirectory, File: FakeFile, Paths: { document }, __files: files, __state: state }
})

const fake = (await import('expo-file-system')) as unknown as {
  __files: Map<string, string>
  __state: { dirExists: boolean; failCreateDir: boolean; failWrite: boolean }
  Paths: { document: { uris: string[] } }
}

const { clearEvidence, EVIDENCE_DIR, persistEvidence, releaseEvidence } = await import('@/features/scout/evidence')

const digestOf = (base64: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, base64)
const evidenceUriFor = async (base64: string) =>
  `${fake.Paths.document.uris.join('/')}/${EVIDENCE_DIR}/${await digestOf(base64)}.jpg`

beforeEach(() => {
  fake.__files.clear()
  fake.__state.dirExists = false
  fake.__state.failCreateDir = false
  fake.__state.failWrite = false
})

describe('persistEvidence', () => {
  it('copies each real shot to a content-addressed file and returns those uris', async () => {
    const result = await persistEvidence([{ uri: 'file:///cache/a.jpg', base64: 'Zm9uZQ==' }])

    const expected = await evidenceUriFor('Zm9uZQ==')
    expect(result).toEqual([expected])
    // The bytes landed under the digest of their own content.
    expect(fake.__files.get(expected)).toBe('Zm9uZQ==')
  })

  it('reuses an existing file for identical content instead of rewriting it', async () => {
    const uri = await evidenceUriFor('Zm9uZQ==')
    fake.__files.set(uri, 'PREVIOUS')
    fake.__state.dirExists = true

    const result = await persistEvidence([{ uri: 'file:///cache/a.jpg', base64: 'Zm9uZQ==' }])

    expect(result).toEqual([uri])
    // Dedupe: the stored pixels were not touched.
    expect(fake.__files.get(uri)).toBe('PREVIOUS')
  })

  it('keeps source uris for shots without addressable bytes, drops empties', async () => {
    const result = await persistEvidence([
      { uri: '', base64: undefined }, // simulated shot
      { uri: 'file:///cache/only-uri.jpg' }, // no bytes captured with it
      { uri: 'file:///cache/real.jpg', base64: 'dHdv' },
    ])

    expect(result).toEqual(['file:///cache/only-uri.jpg', await evidenceUriFor('dHdv')])
  })

  it('falls back to the cache uri per shot when its file cannot be stored, keeping the rest', async () => {
    const badUri = await evidenceUriFor('dHdv')
    const written: string[] = []
    const original = fake.__files.set.bind(fake.__files)
    fake.__files.set = (key: string, value: string) => {
      if (key === badUri) throw new Error('ENOSPC: no space left on device')
      if (value.length > 0) written.push(key)
      return original(key, value)
    }

    const result = await persistEvidence([
      { uri: 'file:///cache/ok.jpg', base64: 'Zm9uZQ==' },
      { uri: 'file:///cache/full.jpg', base64: 'dHdv' },
    ])
    fake.__files.set = original

    expect(result[0]).toBe(await evidenceUriFor('Zm9uZQ==')) // first shot persisted
    expect(result[1]).toBe('file:///cache/full.jpg') // failed shot kept its cache uri
    expect(written).toEqual([await evidenceUriFor('Zm9uZQ==')])
  })

  it('degrades to the cache uris when the evidence directory cannot be created', async () => {
    fake.__state.failCreateDir = true

    const result = await persistEvidence([{ uri: 'file:///cache/a.jpg', base64: 'Zm9uZQ==' }])

    expect(result).toEqual(['file:///cache/a.jpg'])
    expect(fake.__files.size).toBe(0)
  })

  it('returns nothing for an empty capture', async () => {
    expect(await persistEvidence([])).toEqual([])
  })
})

describe('releaseEvidence', () => {
  it('deletes stale evidence files while leaving every active one alone', async () => {
    const activeUri = await evidenceUriFor('Zm9uZQ==')
    const staleUri = await evidenceUriFor('dHdv')
    fake.__files.set(activeUri, 'keep')
    fake.__files.set(staleUri, 'drop')

    await releaseEvidence([activeUri, staleUri], [activeUri])

    expect(fake.__files.has(activeUri)).toBe(true)
    expect(fake.__files.has(staleUri)).toBe(false)
  })

  it('never touches a uri outside the evidence directory', async () => {
    const cacheUri = 'file:///cache/shot.jpg'
    fake.__files.set(cacheUri, 'not ours')

    await releaseEvidence([cacheUri], [])

    expect(fake.__files.has(cacheUri)).toBe(true)
  })

  it('is a no-op when every candidate is still referenced', async () => {
    const uri = await evidenceUriFor('Zm9uZQ==')
    fake.__files.set(uri, 'keep')

    await releaseEvidence([uri], [uri])

    expect(fake.__files.has(uri)).toBe(true)
  })
})

describe('clearEvidence', () => {
  it('erases the whole evidence directory', async () => {
    fake.__state.dirExists = true
    fake.__files.set('file:///doc/evidence/a.jpg', 'x')

    await clearEvidence()

    expect(fake.__state.dirExists).toBe(false)
    expect(fake.__files.size).toBe(0)
  })

  it('does nothing when the directory is absent', async () => {
    await expect(clearEvidence()).resolves.toBeUndefined()
    expect(fake.__state.dirExists).toBe(false)
  })
})
