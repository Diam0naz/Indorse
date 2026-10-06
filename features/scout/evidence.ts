/**
 * features/scout/evidence.ts — durable local evidence for scout captures
 *
 * The chain stores only a SHA-256 digest of the captured bytes; proving the
 * digest needs the pixels. Until now they lived in the OS cache, which
 * Android may evict at any time — the hash and the anchor payload survived
 * a restart, the evidence itself did not (README "known gap", now closed
 * here).
 *
 * At submit time every real shot is copied into app document storage
 * (`evidence/<sha256-of-its-base64>.jpg`), content-addressed:
 *
 *   - the filename IS a hash of the file's own bytes, so anyone holding the
 *     file can re-hash it and check it against the digest the row recorded;
 *   - identical shots dedupe into one file;
 *   - a failed copy falls back to the original cache URI — evidence storage
 *     is best-effort by contract and can never block a submission.
 *
 * There is still no upload backend, so this evidence is device-local: a
 * hosted `uri` (public verification from the chain alone) is documented
 * future work. Device-local means device-local rules — the whole directory
 * is erased with the scouting log in "Account & local data".
 *
 * `expo-file-system` is imported dynamically so this module's graph stays
 * clean for tests and for hosts where the native module is unavailable —
 * every caller degrades to the old best-effort behavior instead of
 * crashing.
 */

import * as Crypto from 'expo-crypto'

/** Sub-directory of the app document directory that holds the pixels. */
export const EVIDENCE_DIR = 'evidence'

/** What the camera hands submit: a cache URI, and the bytes when real. */
export interface EvidenceShot {
  uri?: string
  base64?: string
}

/** Content address of one shot — SHA-256 of its base64 payload, same input
 *  the aggregate `photo_hash` is built from (see `features/scout/photo.ts`). */
async function shotDigest(base64: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, base64)
}

/**
 * Copy every real shot into app storage and return the URIs to record on
 * the row, in order. Simulated shots (no bytes) keep whatever URI they
 * have; any failure — module missing, disk full, bad source — degrades to
 * the original cache URIs, which is exactly what this flow did before.
 */
export async function persistEvidence(shots: EvidenceShot[]): Promise<string[]> {
  const sourceUris = shots.map((shot) => shot.uri ?? '').filter((uri) => uri.length > 0)

  let fs: typeof import('expo-file-system')
  try {
    fs = await import('expo-file-system')
  } catch {
    // No file system in this environment — old behavior, best-effort cache.
    return sourceUris
  }

  try {
    const dir = new fs.Directory(fs.Paths.document, EVIDENCE_DIR)
    if (!dir.exists) dir.create({ intermediates: true })

    const persisted: string[] = []
    for (const shot of shots) {
      const source = shot.uri ?? ''
      if (!shot.base64 || source.length === 0) {
        // Simulated or already-decoded shot — nothing to address by content.
        if (source.length > 0) persisted.push(source)
        continue
      }
      try {
        const digest = await shotDigest(shot.base64)
        const file = new fs.File(dir, `${digest}.jpg`)
        if (!file.exists) {
          file.create()
          file.write(shot.base64, { encoding: 'base64' })
        }
        persisted.push(file.uri)
      } catch {
        // One shot failing must not lose the others — keep its cache URI.
        persisted.push(source)
      }
    }
    return persisted
  } catch {
    return sourceUris
  }
}

/**
 * Delete captured files that no surviving row references any more — called
 * when the log evicts its oldest rows (FIFO cap) or resets. Only URIs under
 * the evidence directory are ever touched: a cache path passed in by
 * mistake is ignored, never deleted.
 */
export async function releaseEvidence(candidateUris: string[], activeUris: string[]): Promise<void> {
  const stale = candidateUris.filter((uri) => uri.length > 0 && !activeUris.includes(uri))
  if (stale.length === 0) return

  let fs: typeof import('expo-file-system')
  try {
    fs = await import('expo-file-system')
  } catch {
    return
  }

  for (const uri of stale) {
    // Hard safety rail: only our own content-addressed files.
    if (!uri.includes(`/${EVIDENCE_DIR}/`)) continue
    try {
      const file = new fs.File(uri)
      if (file.exists) file.delete()
    } catch {
      // A file we cannot delete is a file the next pass will try again.
    }
  }
}

/** Erase every stored evidence file — part of "delete local account data". */
export async function clearEvidence(): Promise<void> {
  let fs: typeof import('expo-file-system')
  try {
    fs = await import('expo-file-system')
  } catch {
    return
  }
  try {
    const dir = new fs.Directory(fs.Paths.document, EVIDENCE_DIR)
    if (dir.exists) dir.delete()
  } catch {
    // Nothing to clear.
  }
}
