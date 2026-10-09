/**
 * features/ai/image.ts — make captured shots fit through the proxy
 *
 * The proxy runs as a Vercel Function, which caps the request body at
 * **4.5 MB** — a limit the platform enforces *before* the handler runs, so an
 * oversized request never reaches `api/_lib/proxy.ts`'s validation and comes
 * back as a bare `413 FUNCTION_PAYLOAD_TOO_LARGE`. The app captures
 * full-resolution JPEGs (`quality: 0.7` is compression only — it does not
 * resize), so a base64 body balloons past that cap after 2–3 shots and the
 * scout flow fails every time.
 *
 * Two layers keep the body inside the cap:
 *
 *   1. `downscaleShot` re-encodes each capture to `MAX_SHOT_EDGE` on its long
 *      edge — a ~1024 px JPEG at `SHOT_COMPRESS` is tens of KB instead of
 *      megabytes, so a full 5-shot report fits with room to spare;
 *   2. `selectUploadable` is the backstop for when re-encoding is unavailable
 *      (manipulator not built into the client yet, unreadable file): it keeps
 *      whole shots, in capture order, while the body stays under
 *      `MAX_PAYLOAD_BYTES`.
 *
 * The manipulator is imported lazily on first use. A dev client built before
 * `expo-image-manipulator` was added resolves that import to a rejection
 * instead of a crash, and the caller keeps the original capture bytes — the
 * budget guard then decides what can still be sent.
 */

import { DEFAULT_MIME_TYPE, type ImageInput } from './types'

/** Longest edge of a shot after downscaling — plenty for a diagnosis. */
export const MAX_SHOT_EDGE = 1024

/** JPEG compression of the downscaled shot (1 = best, 0 = smallest). */
export const SHOT_COMPRESS = 0.6

/**
 * Budget for the whole `{"images":[…]}` body. Vercel's hard cap is 4.5 MB
 * (validated against the deployment: a 5.3 MB body answers 413); 3.5 MB
 * leaves headroom for the JSON envelope and never uploads bytes the platform
 * is about to reject.
 */
export const MAX_PAYLOAD_BYTES = 3_500_000

/** Per-entry JSON overhead (`{"imageBase64":"","mimeType":"image/jpeg"},`). */
const PER_IMAGE_OVERHEAD = 64

type ManipulatorModule = typeof import('expo-image-manipulator')

let manipulator: Promise<ManipulatorModule> | null = null

/** Load the native manipulator once; a failed load stays failed. */
function loadManipulator(): Promise<ManipulatorModule> {
  manipulator ??= import('expo-image-manipulator')
  return manipulator
}

/** A capture, as the camera reported it — dimensions let us skip upscaling. */
export interface CapturedShot {
  uri: string
  width?: number
  height?: number
}

/** One downscaled shot, ready to become an `ImageInput`. */
export interface PreparedShot {
  uri: string
  base64: string
  mimeType: string
  width: number
  height: number
}

/**
 * Re-encode one capture to at most `MAX_SHOT_EDGE` on its long edge. A shot
 * already smaller than the cap is still re-compressed (never upscaled): the
 * camera hands back full-resolution bytes, and the point is a small upload.
 *
 * Throws when the native manipulator cannot be loaded — the caller keeps the
 * original capture rather than losing it.
 */
export async function downscaleShot(shot: CapturedShot): Promise<PreparedShot> {
  return resizeShot(await loadManipulator(), shot)
}

/**
 * The re-encode itself, with the manipulator passed in so the resize decision
 * is unit-testable without a native module (see `image.test.ts`).
 */
export async function resizeShot(module: ManipulatorModule, shot: CapturedShot): Promise<PreparedShot> {
  const { ImageManipulator, SaveFormat } = module
  const width = shot.width ?? 0
  const height = shot.height ?? 0
  const longest = Math.max(width, height)

  const context = ImageManipulator.manipulate(shot.uri)
  if (longest > MAX_SHOT_EDGE) {
    const scale = MAX_SHOT_EDGE / longest
    context.resize({
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    })
  }

  const rendered = await context.renderAsync()
  const saved = await rendered.saveAsync({
    base64: true,
    compress: SHOT_COMPRESS,
    format: SaveFormat.JPEG,
  })
  if (!saved.base64) throw new Error('Image manipulation produced no base64 bytes')

  return {
    uri: saved.uri,
    base64: saved.base64,
    mimeType: DEFAULT_MIME_TYPE,
    width: saved.width,
    height: saved.height,
  }
}

/** Encoded size of the classify body these shots would produce. */
export function payloadBytes(images: ImageInput[]): number {
  return images.reduce((total, image) => total + image.imageBase64.length + PER_IMAGE_OVERHEAD, 0)
}

/**
 * Keep whole shots, in capture order, while the body fits `budget`. Dropping
 * a shot is preferable to the platform rejecting the whole report — the
 * verdict still weighs every angle that made it through, and `dropped` lets
 * the caller say so rather than pretend nothing changed.
 */
export function selectUploadable(
  images: ImageInput[],
  budget: number = MAX_PAYLOAD_BYTES,
): { images: ImageInput[]; dropped: number } {
  const kept: ImageInput[] = []
  let used = 0
  for (const image of images) {
    const next = used + image.imageBase64.length + PER_IMAGE_OVERHEAD
    if (next > budget) break
    kept.push(image)
    used = next
  }
  return { images: kept, dropped: images.length - kept.length }
}
