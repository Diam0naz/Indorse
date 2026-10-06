import { describe, expect, it } from 'vitest'
import { seasonForLocation, seasonKey } from './season'

describe('seasonForLocation', () => {
  it('northern temperate: meteorological windows', () => {
    expect(seasonForLocation(47, 8, new Date('2026-01-15T12:00:00Z'))).toEqual({ name: 'winter', year: 2026 })
    expect(seasonForLocation(47, 8, new Date('2026-04-10T12:00:00Z'))).toEqual({ name: 'spring', year: 2026 })
    expect(seasonForLocation(47, 8, new Date('2026-07-10T12:00:00Z'))).toEqual({ name: 'summer', year: 2026 })
    expect(seasonForLocation(47, 8, new Date('2026-10-05T12:00:00Z'))).toEqual({ name: 'autumn', year: 2026 })
    // DJF belongs to the winter that starts in December.
    expect(seasonForLocation(47, 8, new Date('2026-12-31T12:00:00Z'))).toEqual({ name: 'winter', year: 2026 })
    expect(seasonForLocation(47, 8, new Date('2026-02-01T12:00:00Z'))).toEqual({ name: 'winter', year: 2026 })
  })

  it('southern temperate: the same months carry the opposite season', () => {
    expect(seasonForLocation(-34, -64, new Date('2026-01-15T12:00:00Z'))).toEqual({ name: 'summer', year: 2026 })
    expect(seasonForLocation(-34, -64, new Date('2026-07-10T12:00:00Z'))).toEqual({ name: 'winter', year: 2026 })
    expect(seasonForLocation(-34, -64, new Date('2026-10-05T12:00:00Z'))).toEqual({ name: 'spring', year: 2026 })
    expect(seasonForLocation(-34, -64, new Date('2026-04-10T12:00:00Z'))).toEqual({ name: 'autumn', year: 2026 })
  })

  it('northern tropics: Harmattan (dry) Nov–Mar, rainy Apr–Oct', () => {
    // The demo farm's band — 6.5°N, 3.4°E (southern Nigeria).
    expect(seasonForLocation(6.5, 3.4, new Date('2026-01-10T12:00:00Z'))).toEqual({ name: 'harmattan', year: 2026 })
    expect(seasonForLocation(6.5, 3.4, new Date('2026-12-05T12:00:00Z'))).toEqual({ name: 'harmattan', year: 2026 })
    expect(seasonForLocation(6.5, 3.4, new Date('2026-03-01T12:00:00Z'))).toEqual({ name: 'harmattan', year: 2026 })
    expect(seasonForLocation(6.5, 3.4, new Date('2026-04-01T12:00:00Z'))).toEqual({ name: 'rainy', year: 2026 })
    expect(seasonForLocation(6.5, 3.4, new Date('2026-07-10T12:00:00Z'))).toEqual({ name: 'rainy', year: 2026 })
    expect(seasonForLocation(6.5, 3.4, new Date('2026-10-31T12:00:00Z'))).toEqual({ name: 'rainy', year: 2026 })
    expect(seasonForLocation(6.5, 3.4, new Date('2026-11-01T12:00:00Z'))).toEqual({ name: 'harmattan', year: 2026 })
  })

  it('southern tropics: rainy Nov–Apr, dry May–Oct', () => {
    expect(seasonForLocation(-15, 30, new Date('2026-01-15T12:00:00Z'))).toEqual({ name: 'rainy', year: 2026 })
    expect(seasonForLocation(-15, 30, new Date('2026-07-10T12:00:00Z'))).toEqual({ name: 'dry', year: 2026 })
    expect(seasonForLocation(-15, 30, new Date('2026-04-30T12:00:00Z'))).toEqual({ name: 'rainy', year: 2026 })
    expect(seasonForLocation(-15, 30, new Date('2026-05-01T12:00:00Z'))).toEqual({ name: 'dry', year: 2026 })
  })

  it('boundary: just outside the tropic keeps temperate seasons', () => {
    expect(seasonForLocation(23.45, 0, new Date('2026-07-10T12:00:00Z'))).toEqual({ name: 'summer', year: 2026 })
    expect(seasonForLocation(-23.45, 0, new Date('2026-07-10T12:00:00Z'))).toEqual({ name: 'winter', year: 2026 })
    // Exactly on the tropic line counts as tropical.
    expect(seasonForLocation(23.44, 0, new Date('2026-07-10T12:00:00Z'))).toEqual({ name: 'rainy', year: 2026 })
  })

  it('invalid coordinates stay unknown instead of guessed', () => {
    expect(seasonForLocation(Number.NaN, 10)).toBeNull()
    expect(seasonForLocation(91, 10)).toBeNull()
    expect(seasonForLocation(47, Number.NaN)).toBeNull()
  })

  it('seasonKey maps a name to its i18n key', () => {
    expect(seasonKey('autumn')).toBe('season.autumn')
    expect(seasonKey('harmattan')).toBe('season.harmattan')
  })
})
