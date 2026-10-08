/**
 * constants/data.ts — All mock / seed data for the Indorse UI
 * Mirrors the data constants from the Figma design.
 */

export const USER = {
  name: 'Mae Hollenbeck',
  handle: '@mae.hollenbeck',
  role: 'Farm Operator',
  avatar: 'MH',
  joined: 'Apr 2025',
  farm: 'Clearwater Ridge Farm',
  location: 'Cass County, ND',
  walletPubkey: '7xKp2NvQdMsJhLbWoE4uYTgXcVnAiZ9qR3sPwHFrmR',
  solBalance: 4.218,
  usdcBalance: 1842.5,
  escrowLocked: 1001180,
  nftCerts: 3,
} as const

export const FARM = {
  name: 'Clearwater Ridge Farm',
  season: '2026',
  location: 'Cass County, ND',
  totalAcres: 1840,
  recordPDA: 'FrmRc7xKp2NvQdMsJhLbWoE4uYTgXcVnAiZ9qR3sPwH',
} as const

export interface ScoutEvent {
  id: string
  /** Human display date (`Oct 4`) — cosmetic, never parsed back. */
  date: string
  /**
   * The same instant as `date`, as epoch SECONDS (the on-chain
   * `ScoutReport.timestamp` unit). This is what seasons are derived from:
   * `date` is a formatted string and would have to be parsed, which is
   * exactly the kind of guess `seasonForLocation` exists to avoid. Set at
   * capture time and by `reportToScoutEvent`; absent only on rows written
   * before this field existed, which the season grouping leaves undated.
   */
  timestamp?: number
  field: string
  crop: string
  /**
   * The plant the model actually identified — `commonName`, else
   * `botanicalName`, from the classification at capture time. This is the
   * identity behind the diagnosis (`diagnosis` is what is WRONG with it),
   * so it is what a per-season record of scouted plants is grouped by.
   *
   * Display-only and local: `features/ai/types.ts` pins these names as
   * never reaching the chain, and `crop` stays `'—'` because the Farm
   * account has no crop field. Absent on rows read from chain alone (a
   * fresh install, somebody else's report) — the log then falls back to
   * `crop` and claims nothing.
   */
  plant?: string
  diagnosis: string
  confidence: number
  severity: 'high' | 'medium' | 'low' | 'none'
  txSig: string
  notes: string
  images: number
  lat: number
  lng: number
  /**
   * Set on rows read from the chain (`id` is the report account address).
   * The log renders a status pill for these instead of a confidence score,
   * because the chain stores the review status, not a model probability.
   */
  chainStatus?: 'pending' | 'verified' | 'rejected' | 'rewarded'
  /**
   * Where a locally captured row stands with the chain — absent on rows read
   * from the chain, whose lifecycle is `chainStatus` alone. `queued` is
   * captured and waiting for a farm to anchor it, `failed` an anchor attempt
   * that did not land (kept, with its payload, for an explicit retry), and
   * `anchored` a row that now lives on-chain (`id` is its report address).
   */
  anchorStatus?: 'queued' | 'anchored' | 'failed'
  /**
   * The outbox payload — exactly the fields an anchor flush sends in
   * `submit_scout_report`. Present only while the row is un-anchored, so a
   * restart can finish what the capture started without inventing anything.
   */
  anchor?: ScoutAnchorPayload
  /**
   * Where this capture's pixels live. Real shots are copied into app
   * document storage at submit time (`evidence/<digest>.jpg`, content-
   * addressed so a file re-hashes to the digest the row recorded); when a
   * copy fails the original cache URI is kept — best-effort, never blocked.
   * Unlike `anchor`, this survives anchoring: the digest on-chain proves
   * nothing if the pixels it describes are gone.
   */
  photoUris?: string[]
}

/** What an anchor flush submits for a queued capture (all strings serialisable). */
export interface ScoutAnchorPayload {
  /** SHA-256 hex (64 chars) of the captured bytes — the on-chain photo_hash. */
  photoHashHex: string
  /** Photo URI field, ≤128 bytes on-chain (a deterministic placeholder today). */
  uri: string
  /** Classifier label the chain row should carry, ≤32 bytes. */
  aiLabel: string
  /** Local file URIs of the real shots — best-effort evidence for re-hashing. */
  photoUris: string[]
  /**
   * Set when the capture was taken while scouting a specific farm (the
   * cross-farm target): the flush anchors there instead of the featured
   * farm, and the row keeps the name it was captured under. Absent on
   * ordinary captures, which anchor to whatever farm is featured when the
   * wallet next comes up — exactly as before.
   */
  farmAddress?: string
}

export const SCOUT_EVENTS: ScoutEvent[] = [
  {
    id: 'sc001',
    date: 'Sep 22',
    field: 'East Draw',
    crop: 'Sunflower',
    diagnosis: 'Sclerotinia Head Rot',
    confidence: 0.91,
    severity: 'high',
    txSig: '2xKm9pQwNvRdTs4LbJhFgEcYuXa7VoZiA3nDsP8qCwH1fMtBrK6',
    notes: 'Lesions on 40–60% of heads in SE quadrant. Immediate fungicide application recommended.',
    images: 3,
    lat: 46.8821,
    lng: -98.7023,
  },
  {
    id: 'sc002',
    date: 'Sep 18',
    field: 'River Bottom',
    crop: 'Corn',
    diagnosis: 'Gray Leaf Spot',
    confidence: 0.78,
    severity: 'medium',
    txSig: '5nHs2rPwXvKdMa9JbLgFcEuYTqZoAi7VnDs3Cp8QwH4mBtRf',
    notes: 'Early GLS lesions on lower canopy. Monitor progression. Yield impact ~3–7%.',
    images: 2,
    lat: 46.8654,
    lng: -98.7201,
  },
  {
    id: 'sc003',
    date: 'Sep 14',
    field: 'North Quarter',
    crop: 'Winter Wheat',
    diagnosis: 'No disease detected',
    confidence: 0.96,
    severity: 'none',
    txSig: '7pJd4sQxNwKvMb8LcHgFaEuYTrZoAi6UnCs2Bp7RwH3nAtRe',
    notes: 'Clean scan across all sample points. Crop canopy closed normally.',
    images: 4,
    lat: 46.9012,
    lng: -98.6889,
  },
  {
    id: 'sc004',
    date: 'Sep 8',
    field: 'South Bench',
    crop: 'Soybeans',
    diagnosis: 'Sudden Death Syndrome',
    confidence: 0.62,
    severity: 'low',
    txSig: '3mFb9tRyPwLvNa6KcJgEbUxTqZoAi5VnBs1Dp6SwH2oCtQd',
    notes: 'Interveinal chlorosis on ~5% of plants in field margin.',
    images: 5,
    lat: 46.8511,
    lng: -98.6744,
  },
]

export interface Field {
  id: string
  name: string
  acres: number
  crop: string
  status: 'clean' | 'watch' | 'alert'
  risk: number
}

export const FIELDS: Field[] = [
  { id: 'f1', name: 'North Quarter', acres: 480, crop: 'Winter Wheat', status: 'clean', risk: 0.08 },
  { id: 'f2', name: 'River Bottom', acres: 320, crop: 'Corn', status: 'watch', risk: 0.31 },
  { id: 'f3', name: 'South Bench', acres: 560, crop: 'Soybeans', status: 'clean', risk: 0.11 },
  { id: 'f4', name: 'East Draw', acres: 480, crop: 'Sunflower', status: 'alert', risk: 0.67 },
]

export const ESCROW = {
  buyer: 'Grain Partners Co-op',
  quantity: '45,200 bu',
  commodity: 'Sunflower (Oil)',
  totalValue: 1001180,
  status: 'pending_delivery',
  releaseConditions: ['Delivery confirmed by inspector', 'Grade ≥ No. 1 Oil', 'Moisture ≤ 10%'],
  escrowPDA: 'EscWr4xKp2NvQdMsJhLbWoE4uYTgXcVnAiZ9qR3sFarm',
  buyerPubkey: 'GrPt6wKp2NvQdMsJhLbWoE4uYTgXcVnAiZ9qR3sCoOp',
  provenanceScore: 78,
} as const

/**
 * Parametric weather policy.
 *
 * Everything here is rainfall, in the same mm × 10 units the program stores:
 * `trigger_threshold_mm` and `total_rainfall_mm` are both `u32` scaled by 10 so
 * the on-chain accounts keep one decimal place. Divide by 10 for display.
 *
 * `settle_policy` requires `now >= policy.season_end`, so a mid-season reading
 * that sits below the trigger never pays anything — only the season-end total
 * is ever compared against `triggerThresholdMm`.
 */
export const WEATHER = {
  policyId: 'WP-2026-ND-CC-0047',
  /** Payout condition, phrased the way `settle_policy` actually tests it. */
  coverage: 'Payout triggers if season rainfall falls below 180 mm.',
  triggerPeriod: 'Jun 1 – Sep 30, 2026',
  premium: 4820,
  maxPayout: 96000,
  status: 'active',
  /** mm × 10 — `Policy.trigger_threshold_mm`. 1800 → 180 mm. */
  triggerThresholdMm: 1800,
  /** mm × 10 — `WeatherOracle.total_rainfall_mm`. 2120 → 212 mm. */
  totalRainfallMm: 2120,
  /** mm × 10 — season normal for the "% of normal" reading. 2650 → 265 mm. */
  normalRainfallMm: 2650,
  daysRemaining: 2,
  lastUpdate: 'Sep 28, 18:00 UTC',
} as const

export interface WeatherPoint {
  month: string
  /** Monthly rainfall in mm (September is month-to-date, as of the last reading). */
  mm: number
}

/**
 * Monthly rainfall for the policy season only — `triggerPeriod` runs Jun 1 to
 * Sep 30, so months outside it must not appear or the season total drifts.
 *
 * Sums to 212 mm, matching `WEATHER.totalRainfallMm / 10`.
 */
export const WEATHER_CHART: WeatherPoint[] = [
  { month: 'Jun', mm: 68 },
  { month: 'Jul', mm: 41 },
  { month: 'Aug', mm: 52 },
  { month: 'Sep', mm: 51 },
]

export interface Notification {
  id: string
  type: 'alert' | 'escrow' | 'weather' | 'scout' | 'system'
  title: string
  body: string
  time: string
  read: boolean
}

export interface ActivityItem {
  label: string
  detail: string
  time: string
  color: string
}

// Dot colours follow the palette: red = a disease alert, amber = money moving,
// emerald = clean / confirmed, neutral grey = routine records. Mid-tones so
// they read on both the light and the dark field.
export const ACTIVITY: ActivityItem[] = [
  { label: 'Scout · East Draw', detail: 'Sclerotinia / HIGH', time: 'Sep 22', color: '#E06B5A' },
  { label: 'Escrow funded', detail: '$1,001,180 locked', time: 'Sep 18', color: '#F2A340' },
  { label: 'Scout · River Bottom', detail: 'Gray Leaf Spot / MED', time: 'Sep 18', color: '#9B968C' },
  { label: 'Scout · North Quarter', detail: 'No disease / CLR', time: 'Sep 14', color: '#34B37E' },
  { label: 'Policy issued', detail: 'WP-2026-ND-CC-0047', time: 'Jun 1', color: '#9B968C' },
]

/** Truncate a pubkey for display: FrmRc7…3sPwH */
export function trunc(str: string | undefined, s = 6, e = 4): string {
  if (!str) return '—'
  return `${str.slice(0, s)}…${str.slice(-e)}`
}
