/**
 * features/farm/season.ts — Which season is this farm in, right now?
 *
 * The profile's season is not stored on-chain (the Farm account carries
 * coordinates, not seasons) — it is derived from the farm's geolocation
 * and the calendar, so it needs no contract change and can never drift
 * from reality the way a typed-in season would.
 *
 * Two climate bands, both derived from lat/lng alone:
 *
 *   tropics (|lat| ≤ 23.44°) — no thermal seasons; the year is the wet/dry
 *     rhythm instead:
 *       northern tropics: Harmattan (dry Saharan wind) Nov–Mar,
 *                         rainy Apr–Oct
 *       southern tropics: rainy Nov–Apr, dry May–Oct
 *     Caveat kept honest: tropical calendars vary by longitude (coastal
 *     West Africa and the equatorial belt can split into two rains); this
 *     is the broad climatic window, not a rainfall forecast.
 *
 *   temperate: meteorological seasons — Northern hemisphere Mar–May
 *     spring, Jun–Aug summer, Sep–Nov autumn, Dec–Feb winter; Southern
 *     hemisphere the same windows carrying the opposite meaning.
 *
 *   invalid coordinates: null — unknown stays unknown.
 *
 * The year is the calendar year of observation (display label only).
 */

export type SeasonName = 'winter' | 'spring' | 'summer' | 'autumn' | 'harmattan' | 'rainy' | 'dry'

export interface DerivedSeason {
  name: SeasonName
  year: number
}

/** Southern edge of the tropics — the tropic of Capricorn, in degrees. */
const TROPIC = 23.44

/** Months (1-based) of the northern-tropical Harmattan (dry) window. */
const NORTH_DRY = new Set([11, 12, 1, 2, 3])
/** Months (1-based) of the southern-tropical wet window (one month longer). */
const SOUTH_WET = new Set([11, 12, 1, 2, 3, 4])

export function seasonForLocation(lat: number, lng: number, at: Date = new Date()): DerivedSeason | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90) return null

  const month = at.getMonth() + 1 // 1–12
  const year = at.getFullYear()

  // Tropical bands: wet/dry rhythm instead of thermal seasons.
  if (Math.abs(lat) <= TROPIC) {
    const name: SeasonName =
      lat >= 0 ? (NORTH_DRY.has(month) ? 'harmattan' : 'rainy') : SOUTH_WET.has(month) ? 'rainy' : 'dry'
    return { name, year }
  }

  const north = lat > 0

  // Meteorological windows, Northern hemisphere first.
  const northern: Record<number, { name: SeasonName; year: number }> = {
    3: { name: 'spring', year },
    4: { name: 'spring', year },
    5: { name: 'spring', year },
    6: { name: 'summer', year },
    7: { name: 'summer', year },
    8: { name: 'summer', year },
    9: { name: 'autumn', year },
    10: { name: 'autumn', year },
    11: { name: 'autumn', year },
    12: { name: 'winter', year },
    1: { name: 'winter', year },
    2: { name: 'winter', year },
  }
  const southern: Record<number, { name: SeasonName; year: number }> = {
    3: { name: 'autumn', year },
    4: { name: 'autumn', year },
    5: { name: 'autumn', year },
    6: { name: 'winter', year },
    7: { name: 'winter', year },
    8: { name: 'winter', year },
    9: { name: 'spring', year },
    10: { name: 'spring', year },
    11: { name: 'spring', year },
    12: { name: 'summer', year },
    1: { name: 'summer', year },
    2: { name: 'summer', year },
  }
  return (north ? northern : southern)[month]
}

/** 'season.summer' — the i18n key for a derived season. */
export function seasonKey(name: SeasonName): `season.${SeasonName}` {
  return `season.${name}`
}
