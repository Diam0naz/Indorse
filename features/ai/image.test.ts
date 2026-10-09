/**
 * features/ai/image.test.ts — the upload budget, end to end
 *
 * The proxy sits behind Vercel's 4.5 MB request-body cap, so these are the
 * two rules that keep a scout report inside it: a capture is re-encoded to
 * `MAX_SHOT_EDGE` on its long edge, and an oversized body drops whole shots
 * from the end instead of failing the whole report.
 */

import { describe, it, expect } from 'vitest'
import { resizeShot, selectUploadable, payloadBytes, MAX_PAYLOAD_BYTES, MAX_SHOT_EDGE } from '@/features/ai/image'

type ManipulatorModule = typeof import('expo-image-manipulator')

/** Records the transforms scheduled on the context, then answers a fake file. */
function fakeManipulator(source: { width: number; height: number }) {
  const resizes: Array<{ width: number | null; height: number | null }> = []
  const context = {
    resize(size: { width: number | null; height: number | null }) {
      resizes.push(size)
      return context
    },
    renderAsync: async () => ({
      saveAsync: async () => ({
        uri: 'file:///cache/scaled.jpg',
        base64: 'c2NhbGVk',
        width: source.width,
        height: source.height,
      }),
    }),
  }
  const module = {
    ImageManipulator: { manipulate: () => context },
    SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
  } as unknown as ManipulatorModule
  return { module, resizes }
}

describe('resizeShot', () => {
  it('scales a large capture down to MAX_SHOT_EDGE on its long edge', async () => {
    const { module, resizes } = fakeManipulator({ width: 4000, height: 3000 })

    const shot = await resizeShot(module, { uri: 'file://shut.jpg', width: 4000, height: 3000 })

    expect(resizes).toEqual([{ width: MAX_SHOT_EDGE, height: 768 }])
    expect(shot).toMatchObject({ uri: 'file:///cache/scaled.jpg', base64: 'c2NhbGVk', mimeType: 'image/jpeg' })
  })

  it('honours a portrait aspect ratio', async () => {
    const { module, resizes } = fakeManipulator({ width: 3000, height: 4000 })

    await resizeShot(module, { uri: 'file://shut.jpg', width: 3000, height: 4000 })

    expect(resizes).toEqual([{ width: 768, height: MAX_SHOT_EDGE }])
  })

  it('never upscales a capture that is already smaller than the cap', async () => {
    const { module, resizes } = fakeManipulator({ width: 640, height: 480 })

    await resizeShot(module, { uri: 'file://shut.jpg', width: 640, height: 480 })

    expect(resizes).toEqual([])
  })

  it('stays re-compressible when the camera reports no dimensions', async () => {
    const { module, resizes } = fakeManipulator({ width: 1, height: 1 })

    await resizeShot(module, { uri: 'file://shut.jpg' })

    expect(resizes).toEqual([])
  })

  it('rejects a result with no bytes so the caller can keep the original', async () => {
    const module = {
      ImageManipulator: {
        manipulate: () => ({
          resize: () => undefined,
          renderAsync: async () => ({ saveAsync: async () => ({ uri: 'file://empty.jpg', base64: '' }) }),
        }),
      },
      SaveFormat: { JPEG: 'jpeg' },
    } as unknown as ManipulatorModule

    await expect(resizeShot(module, { uri: 'file://shut.jpg', width: 100, height: 100 })).rejects.toThrow(/no base64/)
  })
})

describe('selectUploadable', () => {
  const shot = (bytes: number) => ({ imageBase64: 'a'.repeat(bytes) })

  it('keeps every shot when the whole body fits', () => {
    const images = [shot(10), shot(10), shot(10)]

    expect(selectUploadable(images, 1000)).toEqual({ images, dropped: 0 })
  })

  it('keeps whole shots in order and drops the overflow from the end', () => {
    const first = shot(400)
    const second = shot(400)
    const third = shot(400)

    const result = selectUploadable([first, second, third], 1_000)

    expect(result.images).toEqual([first, second])
    expect(result.dropped).toBe(1)
  })

  it('reports every shot dropped when even the first cannot fit', () => {
    const result = selectUploadable([shot(5_000)], 1_000)

    expect(result.images).toEqual([])
    expect(result.dropped).toBe(1)
  })

  it('budgets a full five-shot report of downscaled photos', () => {
    // ~250 KB each after a 1024 px re-encode: a realistic 5-shot report.
    const images = Array.from({ length: 5 }, () => shot(250_000))

    expect(payloadBytes(images)).toBeLessThan(MAX_PAYLOAD_BYTES)
    expect(selectUploadable(images).dropped).toBe(0)
  })
})
