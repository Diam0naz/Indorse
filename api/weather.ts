/**
 * api/weather.ts — Live weather endpoint (Node/Express-compatible for Vercel functions)
 *
 * Aggregates live values for the Weather screen:
 * - Policy stays static (on-chain config in the real app)
 * - Season rainfall: mm actually recorded between season_start and now
 * - % of normal: a trailing-365-day baseline scaled to the season's length
 * - Season chart: monthly rainfall across the policy window (Jun → Sep)
 * - daysRemaining: computed from the policy end date (Sep 30, 2026 in constants)
 *
 * Rainfall only. This is the same quantity `submit_weather_reading` posts and
 * `settle_policy` compares, returned in the same mm × 10 units the program
 * stores, so the screen, the chart and the chain all speak one language.
 */

import { WEATHER } from '@/constants/data'

const LAT = 46.8821
const LON = -98.7023
const TIMEZONE = 'UTC'

const SEASON_START = new Date('2026-06-01T00:00:00Z')
const SEASON_END = new Date('2026-09-30T23:59:59Z')

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10)
}

function addDays(d: Date, days: number) {
  const n = new Date(d)
  n.setDate(n.getDate() + days)
  return n
}

async function fetchJson(url: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

interface Daily {
  time: string[]
  precipitation_sum: (number | null)[]
}

export interface WeatherLive {
  policyId: string
  coverage: string
  triggerPeriod: string
  premium: number
  maxPayout: number
  status: 'active' | 'expired'
  /** mm × 10 — `WeatherOracle.total_rainfall_mm`. 2120 → 212 mm. */
  totalRainfallMm: number
  /** mm × 10 — `Policy.trigger_threshold_mm`. 1800 → 180 mm. */
  triggerThresholdMm: number
  /** Season rainfall against the trailing-year baseline, as a percentage. */
  precipPct: number
  daysRemaining: number
  lastUpdate: string
  chart: Array<{ month: string; mm: number }>
}

export async function GET() {
  const now = new Date()
  /* Keep the season request inside its own window: before Jun 1 we still ask
     for the season's first day, and after Sep 30 we stop at the season end. */
  const seasonThrough = new Date(Math.min(Math.max(now.getTime(), SEASON_START.getTime()), SEASON_END.getTime()))
  const baselineStart = addDays(now, -365)

  const [dSeason, dYear] = (await Promise.all([
    fetchJson(
      `https://archive-api.open-meteo.com/v1/archive?latitude=${LAT}&longitude=${LON}&start_date=${isoDate(
        SEASON_START,
      )}&end_date=${isoDate(seasonThrough)}&daily=precipitation_sum&timezone=${TIMEZONE}`,
    ),
    fetchJson(
      `https://archive-api.open-meteo.com/v1/archive?latitude=${LAT}&longitude=${LON}&start_date=${isoDate(
        baselineStart,
      )}&end_date=${isoDate(now)}&daily=precipitation_sum&timezone=${TIMEZONE}`,
    ),
  ])) as Array<{ daily: Daily }>

  const sumPrecip = (daily: Daily) =>
    daily.precipitation_sum.filter((v): v is number => v != null && !Number.isNaN(v)).reduce((s, v) => s + v, 0)

  const seasonMm = sumPrecip(dSeason.daily)

  /* Baseline: what this much of a year normally delivers, pro-rated to the
     number of days the season has actually run. */
  const seasonDays = Math.max(1, Math.round((seasonThrough.getTime() - SEASON_START.getTime()) / 86400000) + 1)
  const baselineMm = (sumPrecip(dYear.daily) / 365) * seasonDays
  const precipPct = baselineMm <= 0 ? 100 : Math.round((seasonMm / baselineMm) * 100)

  // Season chart: one bin per policy month, from the season fetch alone.
  const byMonth: Record<string, number[]> = {}
  for (let i = 0; i < dSeason.daily.time.length; i++) {
    const p = dSeason.daily.precipitation_sum[i]
    if (p == null || Number.isNaN(p)) continue
    const mkey = dSeason.daily.time[i].slice(0, 7)
    ;(byMonth[mkey] ??= []).push(p)
  }
  const chart = Object.keys(byMonth)
    .sort()
    .map((mk) => ({
      month: new Date(`${mk}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }),
      mm: Math.round(byMonth[mk].reduce((s, v) => s + v, 0) * 10) / 10,
    }))

  const msLeft = SEASON_END.getTime() - now.getTime()
  const daysRemaining = Math.max(0, Math.ceil(msLeft / (24 * 3600 * 1000)))

  const hasPolicy = WEATHER.policyId.length > 0
  const status: 'active' | 'expired' = hasPolicy && daysRemaining <= 0 ? 'expired' : 'active'

  const body: WeatherLive = {
    policyId: WEATHER.policyId,
    coverage: WEATHER.coverage,
    triggerPeriod: WEATHER.triggerPeriod,
    premium: WEATHER.premium,
    maxPayout: WEATHER.maxPayout,
    status,
    totalRainfallMm: Math.round(seasonMm * 10),
    triggerThresholdMm: WEATHER.triggerThresholdMm,
    precipPct,
    daysRemaining,
    lastUpdate:
      new Date().toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' }) + ' UTC',
    chart,
  }

  return Response.json(body)
}
