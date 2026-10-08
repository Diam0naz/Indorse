/**
 * components/camera-overlay.tsx — Field scouting camera overlay
 *
 * Real capture UI: `CameraView` from expo-camera when the user has granted
 * access, with a live GPS fix (expo-location) in the top chrome. When the
 * camera is unavailable or denied, it falls back to a themed empty state
 * (dashed ring + camera-off icon) so the flow still works — the preview
 * badge keeps labelling the non-live feed.
 *
 * The flow is a four-stage machine, one visible purpose per stage:
 *
 *   capture    → viewfinder, shutter, shot tray (up to 5), live AI chip;
 *   analyzing  → a modal that scans the *captured thumbnails* (never the
 *                live view) with step status while every shot rides to the
 *                model in one call;
 *   result     → a diagnosis card reporting the verdict (label, confidence,
 *                notes) — or an honest "AI unavailable" when none landed,
 *                with submit gated behind "Retry analysis" whenever a
 *                configured proxy failed to produce a diagnosis;
 *   success    → a "Report filed" card with an explicit path to the log,
 *                instead of the overlay silently disappearing.
 *
 * Nothing in this overlay is a placeholder:
 *   - the field label is the connected wallet's on-chain farm name (or an
 *     honest "Unregistered area" when there is none) — the Farm account has
 *     no crop field, so no crop is invented;
 *   - the shot counter counts captures the user actually took (up to 5),
 *     and the result card reports that same count;
 *   - the AI chip probes the classify proxy on open (checking / ready /
 *     unavailable) and the diagnosis card reports the live classification;
 *   - with no configured proxy, a submit without a verdict still sends
 *     `unclassified` with severity `none` (demo/offline honesty); with a
 *     proxy configured, submit stays disabled until a diagnosis lands —
 *     never a seeded diagnosis, and the local row mirrors exactly that.
 *
 * The shutter captures into `shots`; "Analyze crop" runs the classifier on
 * every captured shot (`features/ai/usePhotoClassification`) and the result
 * card shows the live verdict. "Submit to Chain" hands a freshly built
 * ScoutEvent back to the caller so the scouting log updates immediately —
 * without a farm it hands back a local row instead, carrying the `anchor`
 * payload (photo hash, uri, label) the log store persists so the capture
 * can be anchored to the chain after a restart, once a farm exists.
 */

import { useEffect, useRef, useState } from 'react'
import { Animated, Easing, Image, Modal, Pressable, Text, View } from 'react-native'
import Svg, { Circle, Path } from 'react-native-svg'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CameraView, useCameraPermissions } from 'expo-camera'
import * as Haptics from 'expo-haptics'
import { useTheme } from '@/components/theme-provider'
import { useNotifications } from '@/components/notifications'
import { createStyles, fontSizes, fontWeights, radii, spacing, type Colors } from '@/constants/theme'
import { getClassifyEndpoint } from '@/features/ai/classify'
import { usePhotoClassification } from '@/features/ai/usePhotoClassification'
import { SeedVaultBadge } from '@/components/seed-vault-badge'
import { useSubmitReport } from '@/features/reports/useSubmitReport'
import { demoPhotoHash } from '@/features/reports/types'
import { getCurrentCoords, type ScoutCoords } from '@/features/scout/location'
import { persistEvidence } from '@/features/scout/evidence'
import { photoHash } from '@/features/scout/photo'
import type { ScoutEvent } from '@/constants/data'
import { formatShortDate } from '@/lib/format'
import { useT } from '@/lib/i18n'

interface CameraOverlayProps {
  onClose: () => void
  onSubmit?: (event: ScoutEvent) => void
  /**
   * Registered farm PDA. When set, "Submit to Chain" builds and sends a real
   * `submit_scout_report` transaction (and the row lands on-chain). Without
   * one — disconnected or unregistered — the capture stays a local event.
   */
  farmAddress?: string | null
  /**
   * On-chain farm name — the real source for the viewfinder's field label.
   * Null renders an honest "Unregistered area" instead of a seeded name.
   */
  farmName?: string | null
  /**
   * Farm identity to stamp on QUEUED (local) captures — the cross-farm
   * scout target. A capture taken while the wallet is down still anchors
   * to the farm it was taken at, instead of whatever farm happens to be
   * featured when the outbox next flushes. Absent on ordinary captures,
   * which keep the old "anchor to the featured farm" behaviour.
   */
  queuedFarmAddress?: string | null
}

/** Where the AI chip stands: probed on open, never guessed. */
type AiEndpointStatus = 'checking' | 'up' | 'down' | 'unset'

/** The flow's visible stage: capture shots → analyzing modal → diagnosis → filed. */
type Stage = 'capture' | 'analyzing' | 'result' | 'success'

/** Fallback point when the device cannot produce a fix. */
const FALLBACK_GPS = { lat: 46.8821, lng: -98.7023 }

/** Keep the scanline visible at least this long so the scan reads as work. */
const SCAN_MS = 1400

/** Shots per report — the counter is real, this is its ceiling. */
const MAX_SHOTS = 5

/**
 * What goes on-chain when no verdict landed. The Farm account has no crop
 * field and chain rows render `—`, so local rows match that instead of
 * inventing a crop.
 */
const NO_CROP = '—'

/** Honest aiLabel when the classifier produced nothing (≤ 32 bytes). */
const NO_AI_LABEL = 'unclassified'

function bytesToHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
}

interface CapturedPhoto {
  uri: string
  base64: string
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function CameraOverlay({ onClose, onSubmit, farmAddress, farmName, queuedFarmAddress }: CameraOverlayProps) {
  const [stage, setStage] = useState<Stage>('capture')
  const [shots, setShots] = useState<CapturedPhoto[]>([])
  // Endpoint state is decided at construction (configured or not); the effect
  // below only ever resolves it asynchronously — no setState in effect body.
  const [aiEndpoint, setAiEndpoint] = useState<AiEndpointStatus>(() => (getClassifyEndpoint() ? 'checking' : 'unset'))
  const [coords, setCoords] = useState<ScoutCoords | null>(null)
  const [locating, setLocating] = useState(true)
  const [stripHeight, setStripHeight] = useState(0)
  const [scan] = useState(() => new Animated.Value(0))
  const cameraRef = useRef<CameraView>(null)
  const cancelled = useRef(false)
  const [permission, requestPermission] = useCameraPermissions()
  const submitReport = useSubmitReport()
  const { classification, classifying, classify, reset: resetClassification } = usePhotoClassification()
  const { add } = useNotifications()
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const styles = makeStyles(colors)
  const t = useT()

  const usesRealCamera = permission?.granted === true

  /* The overlay is mounted only while it is open, so state starts fresh every
     time; the guard stops async work from landing after a close. */
  useEffect(() => {
    cancelled.current = false
    return () => {
      cancelled.current = true
    }
  }, [])

  /* One fix on mount; the chip falls back to "locating"/"no fix" meanwhile. */
  useEffect(() => {
    let active = true
    getCurrentCoords()
      .then((fix) => {
        if (active) setCoords(fix)
      })
      .finally(() => {
        if (active) setLocating(false)
      })
    return () => {
      active = false
    }
  }, [])

  /* Reachability probe for the classify proxy — any HTTP response (the
     handler answers 405 to GET) means "up"; only a network failure means
     "down". A failure retries a few times while the sheet stays open: tunnel
     flaps are transient (the host watchdog repairs them within seconds), so
     one bad instant must not leave the chip red for the whole session — the
     wrapped fetch already re-races origins per attempt, these retries only
     cover the time dimension. Skipped entirely when unconfigured. */
  useEffect(() => {
    const endpoint = getClassifyEndpoint()
    if (!endpoint) return
    let active = true
    let attempt = 0
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | undefined

    const probe = () => {
      controller = new AbortController()
      const timer = setTimeout(() => controller?.abort(), 4000)
      fetch(endpoint, { method: 'GET', signal: controller.signal })
        .then(() => {
          if (active) setAiEndpoint('up')
        })
        .catch(() => {
          if (!active) return
          attempt += 1
          setAiEndpoint('down')
          if (attempt < 5) retryTimer = setTimeout(probe, 2500)
        })
        .finally(() => clearTimeout(timer))
    }
    probe()

    return () => {
      active = false
      if (retryTimer) clearTimeout(retryTimer)
      controller?.abort()
    }
  }, [])

  /* Scanline loop across the captured thumbnails while the classifier runs */
  useEffect(() => {
    if (stage !== 'analyzing') {
      scan.stopAnimation()
      scan.setValue(0)
      return
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(scan, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(scan, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    )
    animation.start()
    return () => animation.stop()
  }, [stage, scan])

  async function capturePhoto(): Promise<CapturedPhoto | null> {
    if (!usesRealCamera || !cameraRef.current) return null
    try {
      const shot = await cameraRef.current.takePictureAsync({ quality: 0.7, base64: true })
      if (!shot?.uri) return null
      return { uri: shot.uri, base64: shot.base64 ?? '' }
    } catch {
      // A failed capture falls through to the local event path.
      return null
    }
  }

  /** Capture one shot into the tray. The count is what the chip reports. */
  async function handleCapture() {
    if (stage !== 'capture' || shots.length >= MAX_SHOTS) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    const captured = await capturePhoto()
    if (cancelled.current) return
    // The simulated preview still counts as an attempt — it is labelled as
    // simulated; only real bytes reach the hash and the classifier.
    setShots((prev) => [...prev, captured ?? { uri: '', base64: '' }])
  }

  /**
   * Run the classifier on every captured shot, then present the verdict.
   * The analyzing modal scans the captured thumbnails while this is in
   * flight; on landing, the result stage reports the diagnosis — or, when a
   * configured proxy failed, gates submit behind an explicit retry.
   */
  async function runAnalysis() {
    if (shots.length === 0) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setStage('analyzing')

    const bytes = shots.filter((s) => s.base64).map((s) => s.base64)
    const [, verdict] = await Promise.all([delay(SCAN_MS), bytes.length > 0 ? classify(bytes) : Promise.resolve(null)])
    if (cancelled.current) return

    setStage('result')
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)

    // Tell the farmer what the model saw — a feed item at the top of the
    // notification sheet. High/medium severities arrive as `alert`, the rest
    // as `scout`; the diagnosis preference switch filters inside the provider.
    if (verdict) {
      add({
        type: verdict.severity === 'high' || verdict.severity === 'medium' ? 'alert' : 'scout',
        title: t('notif.diagnosisTitle', { label: verdict.label }),
        body: verdict.notes,
      })
    }
  }

  function handleAnalyze() {
    if (stage !== 'capture' || shots.length === 0) return
    void runAnalysis()
  }

  /** Re-run the analysis on the same shots after a failed diagnosis. */
  function handleRetry() {
    resetClassification()
    submitReport.reset()
    void runAnalysis()
  }

  function handleRetake() {
    resetClassification()
    setStage('capture')
    setShots([])
    scan.setValue(0)
    submitReport.reset()
  }

  /**
   * What the row and the chain get: the live verdict when one landed,
   * otherwise an honest "no classification" (never a seeded diagnosis).
   * The notes fall back to the photo URI — exactly what a chain row shows.
   */
  function buildVerdict(uri: string): Pick<ScoutEvent, 'diagnosis' | 'confidence' | 'severity' | 'notes'> {
    if (classification) {
      return {
        diagnosis: classification.label,
        confidence: classification.confidence,
        severity: classification.severity,
        notes: classification.notes,
      }
    }
    return { diagnosis: NO_AI_LABEL, confidence: 0, severity: 'none', notes: uri }
  }

  /** A configured proxy produced no verdict — submit stays locked until a retry lands one. */
  const diagnosisGated = !!getClassifyEndpoint() && !classification

  async function handleSubmit() {
    if (submitReport.isPending || diagnosisGated) return
    const point = coords ?? FALLBACK_GPS
    const stamp = Date.now()
    const uri = `indorse://scout/${stamp}.jpg`
    const realBytes = shots.filter((s) => s.base64).map((s) => s.base64)
    // Real captures hash their bytes together; the simulated path keeps a
    // deterministic digest derived from the capture time.
    const hash = realBytes.length ? await photoHash(realBytes.join('|')) : demoPhotoHash(String(stamp))
    // Durable pixels: copy every real shot into app storage, content-addressed
    // by its own digest. Falls back to the cache URIs on any failure, so this
    // can never block a submission.
    const photoUris = await persistEvidence(shots)

    // Shared by both paths: real date, real farm name (or honest fallback),
    // no invented crop, the actual number of captured shots.
    const base: Pick<ScoutEvent, 'date' | 'timestamp' | 'field' | 'crop' | 'plant' | 'images' | 'lat' | 'lng'> = {
      date: formatShortDate(stamp / 1000),
      // The epoch twin of `date` — seasons are derived from this, never from
      // the formatted string. Same instant the display date was made from.
      timestamp: Math.floor(stamp / 1000),
      field: farmName ?? t('scout.cam.unregistered'),
      crop: NO_CROP,
      /**
       * The plant behind the diagnosis — what the per-season record is
       * grouped by. Deliberately local and display-only: it is absent from
       * `anchor` below, so it is never submitted, and `features/ai/types.ts`
       * pins these names as never reaching the chain. Unidentified → left
       * undefined so the row claims no plant rather than inventing one.
       */
      plant: classification?.commonName ?? classification?.botanicalName ?? undefined,
      images: realBytes.length,
      lat: point.lat,
      lng: point.lng,
    }

    if (!farmAddress) {
      // No registered farm to anchor against — keep the capture as a local
      // row, carrying the outbox payload a restart needs to anchor it later:
      // exactly the fields the chain path would have sent, nothing invented.
      const aiLabel = classification?.label ?? NO_AI_LABEL
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      onSubmit?.({
        ...base,
        ...buildVerdict(uri),
        id: `sc${stamp}`,
        // Local rows carry the photo digest until a chain row replaces it.
        txSig: bytesToHex(hash),
        photoUris,
        anchor: {
          photoHashHex: bytesToHex(hash),
          uri,
          aiLabel,
          // Real shot files only — best-effort evidence to re-derive the hash.
          photoUris,
          // The scout target, when one is set: this capture anchors to the
          // farm it was taken at, not to whatever farm is featured later.
          ...(queuedFarmAddress ? { farmAddress: queuedFarmAddress } : {}),
        },
      })
      setStage('success')
      return
    }

    submitReport.mutate(
      {
        farmAddress,
        photoHash: hash,
        // The local file URI usually exceeds the 128-byte on-chain field, and
        // there is no upload backend yet — store a deterministic placeholder.
        uri,
        lat: point.lat,
        lng: point.lng,
        // The live label when the proxy landed one; honestly unclassified otherwise.
        aiLabel: classification?.label ?? NO_AI_LABEL,
      },
      {
        onSuccess: (reportAddress) => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
          // The row mirrors what actually went on-chain — and keeps the
          // pixels the digest describes, so evidence outlives the anchor.
          onSubmit?.({
            ...base,
            ...buildVerdict(uri),
            id: reportAddress,
            txSig: reportAddress,
            chainStatus: 'pending',
            photoUris,
          })
          setStage('success')
        },
        onError: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
        },
      },
    )
  }

  /** Pending → proxy in flight; landed → real diagnosis; else → unavailable. */
  function classificationMeta(): string {
    if (classifying) return t('scout.cam.classifying')
    if (classification) {
      return t('scout.cam.aiResult', {
        label: classification.label,
        pct: Math.round(classification.confidence * 100),
      })
    }
    return t('scout.cam.noAi')
  }

  /** The AI chip mirrors the probed endpoint state — checking / ready / down. */
  function aiChip(): { text: string; color: string } {
    switch (aiEndpoint) {
      case 'checking':
        return { text: t('scout.cam.aiChecking'), color: colors.textMuted }
      case 'up':
        return { text: t('scout.cam.aiReady'), color: colors.sage }
      case 'down':
        return { text: t('scout.cam.noAi'), color: colors.dangerText }
      default:
        return { text: t('scout.cam.noAi'), color: colors.textMuted }
    }
  }

  const translateY = scan.interpolate({
    inputRange: [0, 1],
    outputRange: [0, Math.max(stripHeight - 2, 0)],
  })

  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.root}>
        {/* ── Viewfinder ─────────────────────────────────────── */}
        <View style={styles.viewfinder}>
          {usesRealCamera ? (
            <CameraView ref={cameraRef} style={styles.cameraPreview} facing="back" />
          ) : (
            <View style={styles.scene} pointerEvents="none">
              <View style={styles.sceneGlow} />
              <View style={styles.sceneIcon}>
                <Svg width={28} height={28} viewBox="0 0 28 28" fill="none">
                  <Path
                    d="M4 9.5C4 8 5.2 6.8 6.7 6.8h1L9 4.5h6l1.3 2.3h1c1.5 0 2.7 1.2 2.7 2.7v9c0 1.5-1.2 2.7-2.7 2.7H6.7C5.2 21.2 4 20 4 18.5v-9z"
                    stroke={colors.textDim}
                    strokeWidth={1.4}
                    fill="none"
                  />
                  <Circle cx={14} cy={13} r={3.4} stroke={colors.textDim} strokeWidth={1.4} fill="none" />
                  <Path d="M3 24 25 4" stroke={colors.textDim} strokeWidth={1.4} strokeLinecap="round" />
                </Svg>
              </View>
            </View>
          )}

          {/* Diagnosis card — the verdict, or an honest "no diagnosis" */}
          {stage === 'result' && (
            <View style={styles.doneOverlay}>
              <View style={[styles.doneBadge, classification ? null : styles.doneBadgeWarn]}>
                {classification ? (
                  <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
                    <Path
                      d="M5 12 L10 17 L19 8"
                      stroke={colors.sageLight}
                      strokeWidth={2.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </Svg>
                ) : (
                  <Text style={styles.doneBadgeBang}>!</Text>
                )}
              </View>
              <Text style={styles.doneTitle}>
                {shots.length <= 1 ? t('scout.cam.capturedOne') : t('scout.cam.captured', { n: shots.length })}
              </Text>
              {classification ? (
                <>
                  <Text style={styles.diagnosisLabel}>{classification.label}</Text>
                  {classification.pathogenName ? (
                    <Text style={styles.diagnosisPathogen}>{classification.pathogenName}</Text>
                  ) : null}
                  {classification.commonName || classification.botanicalName ? (
                    <Text style={styles.diagnosisPlant}>
                      {classification.commonName ?? ''}
                      {classification.commonName && classification.botanicalName ? ' · ' : ''}
                      {classification.botanicalName ? (
                        <Text style={styles.diagnosisBotanical}>{classification.botanicalName}</Text>
                      ) : null}
                    </Text>
                  ) : null}
                  <Text style={styles.diagnosisConfidence}>
                    {t('scout.cam.confidence', { pct: Math.round(classification.confidence * 100) })}
                  </Text>
                  <Text style={styles.diagnosisNotes}>{classification.notes}</Text>
                </>
              ) : (
                <Text style={styles.doneMeta}>{classificationMeta()}</Text>
              )}
              {/* Seeker-only: signing keys sit in the device Seed Vault. */}
              <SeedVaultBadge />
            </View>
          )}

          {/* Filed — an explicit end state with a clear path to the log */}
          {stage === 'success' && (
            <View style={styles.doneOverlay}>
              <View style={styles.doneBadge}>
                <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
                  <Path
                    d="M5 12 L10 17 L19 8"
                    stroke={colors.sageLight}
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
              </View>
              <Text style={styles.doneTitle}>{t('scout.cam.filed')}</Text>
              <Text style={styles.doneMeta}>{t('scout.cam.filedBody')}</Text>
            </View>
          )}

          {/* Top chrome: back button + GPS, kept clear of the status bar */}
          <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
            <Pressable
              style={styles.backBtn}
              onPress={onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('scout.cam.back')}
            >
              <Svg width={16} height={16} viewBox="0 0 16 16" fill="none">
                <Path
                  d="M10 3.5 5.5 8 10 12.5"
                  stroke={colors.textPrimary}
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
              <Text style={styles.backText}>{t('scout.cam.back')}</Text>
            </Pressable>

            <View style={styles.gpsChip}>
              <View style={styles.gpsHeader}>
                <View style={[styles.gpsDot, coords ? null : styles.gpsDotPending]} />
                <Text style={styles.gpsLabel}>{t('scout.cam.gps')}</Text>
              </View>
              {coords ? (
                <>
                  <Text style={styles.gpsCoord}>
                    {coords.lat.toFixed(4)}° N · {Math.abs(coords.lng).toFixed(4)}° W
                  </Text>
                  <Text style={styles.gpsAcc}>
                    {coords.accuracy != null
                      ? t('scout.cam.accuracy', { acc: Math.round(coords.accuracy) })
                      : t('scout.cam.gpsFixed')}
                  </Text>
                </>
              ) : (
                <Text style={styles.gpsCoord}>{locating ? t('scout.cam.locating') : t('scout.cam.noGps')}</Text>
              )}
            </View>
          </View>

          {/* Camera permission prompt (simulated preview stays behind it) */}
          {permission && !permission.granted && (
            <View style={styles.permissionCard}>
              <Text style={styles.permissionText}>{t('scout.cam.cameraNeeded')}</Text>
              <Pressable
                style={styles.permissionBtn}
                onPress={() => requestPermission()}
                accessibilityRole="button"
                accessibilityLabel={t('scout.cam.enableCamera')}
              >
                <Text style={styles.permissionBtnText}>{t('scout.cam.enableCamera')}</Text>
              </Pressable>
            </View>
          )}

          {/* Simulated-preview badge — explains the non-live feed */}
          {!usesRealCamera && stage === 'capture' && (
            <View style={[styles.previewBadge, { top: insets.top + 92 }]}>
              <Text style={styles.previewBadgeText}>{t('scout.cam.preview')}</Text>
            </View>
          )}

          {/* Field label — the real farm name, or an honest fallback */}
          <View style={styles.fieldLabel}>
            <Text style={styles.fieldLabelText}>{farmName ?? t('scout.cam.unregistered')}</Text>
          </View>
        </View>

        {/* ── Controls ───────────────────────────────────────── */}
        <View style={[styles.controls, { paddingBottom: Math.max(insets.bottom, spacing.lg) + spacing.md }]}>
          {stage === 'capture' ? (
            <View>
              <Text style={styles.hint}>
                {shots.length > 0 ? t('scout.cam.hintReady', { n: shots.length }) : t('scout.cam.hint')}
              </Text>
              <View style={styles.controlRow}>
                <View style={styles.chip}>
                  <Svg width={14} height={14} viewBox="0 0 14 14" fill="none">
                    <Path
                      d="M2 4.5C2 3.4 2.9 2.5 4 2.5h.5l1-1.5h3l1 1.5H10c1.1 0 2 .9 2 2v5c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2v-5z"
                      stroke={colors.textMuted}
                      strokeWidth={1.2}
                      fill="none"
                    />
                    <Circle cx={7} cy={7} r={2} stroke={colors.textMuted} strokeWidth={1.2} fill="none" />
                  </Svg>
                  <Text style={styles.chipText}>{t('scout.cam.shots', { n: shots.length, m: MAX_SHOTS })}</Text>
                </View>

                <Pressable
                  style={[styles.shutter, shots.length >= MAX_SHOTS && styles.shutterDisabled]}
                  onPress={handleCapture}
                  disabled={shots.length >= MAX_SHOTS}
                  accessibilityLabel={t('scout.cam.capture')}
                >
                  <View style={styles.shutterInner} />
                </Pressable>

                <View style={styles.chip}>
                  <Svg width={14} height={14} viewBox="0 0 14 14" fill="none">
                    <Path d="M7 3.2v3.9l2.4 1.6" stroke={aiChip().color} strokeWidth={1.2} strokeLinecap="round" />
                    <Path
                      d="M1.6 7a5.4 5.4 0 1 0 1.6-3.8"
                      stroke={aiChip().color}
                      strokeWidth={1.2}
                      strokeLinecap="round"
                    />
                  </Svg>
                  <Text style={[styles.chipText, { color: aiChip().color }]}>{aiChip().text}</Text>
                </View>
              </View>

              {/* Analysis is an explicit step: the button only exists once
                  there are shots to classify. */}
              {shots.length > 0 ? (
                <Pressable
                  style={styles.analyzeBtn}
                  onPress={handleAnalyze}
                  accessibilityRole="button"
                  accessibilityLabel={t('scout.cam.analyze')}
                >
                  <Text style={styles.analyzeText}>{t('scout.cam.analyze')}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : stage === 'result' ? (
            <View>
              <View style={styles.actionRow}>
                <Pressable style={styles.retakeBtn} onPress={handleRetake} disabled={submitReport.isPending}>
                  <Text style={styles.retakeText}>{t('scout.cam.retake')}</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.submitBtn,
                    (submitReport.isPending || classifying || diagnosisGated) && styles.submitBusy,
                  ]}
                  onPress={handleSubmit}
                  disabled={submitReport.isPending || classifying || diagnosisGated}
                >
                  <Text style={styles.submitText}>
                    {submitReport.isPending ? t('scout.cam.submitting') : t('scout.cam.submit')}
                  </Text>
                </Pressable>
              </View>

              {diagnosisGated ? (
                <>
                  <Pressable
                    style={styles.analyzeBtn}
                    onPress={handleRetry}
                    accessibilityRole="button"
                    accessibilityLabel={t('scout.cam.retry')}
                  >
                    <Text style={styles.analyzeText}>{t('scout.cam.retry')}</Text>
                  </Pressable>
                  <Text style={styles.gatedHint}>{t('scout.cam.needDiagnosis')}</Text>
                </>
              ) : submitReport.isError && submitReport.error ? (
                <Text style={styles.submitError}>
                  {t('scout.cam.submitFailed')} — {submitReport.error.message}
                </Text>
              ) : !farmAddress ? (
                <Text style={styles.noFarmHint}>{t('scout.cam.noFarm')}</Text>
              ) : null}
            </View>
          ) : stage === 'success' ? (
            <Pressable
              style={styles.submitBtn}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={t('scout.cam.viewLog')}
            >
              <Text style={styles.submitText}>{t('scout.cam.viewLog')}</Text>
            </Pressable>
          ) : null}
        </View>

        {/* ── Analyzing modal — scans the captured shots, never the live view */}
        {stage === 'analyzing' && (
          <View style={styles.analyzeOverlay}>
            <Text style={styles.analyzeTitle}>{t('scout.cam.analyzingTitle')}</Text>
            <View style={styles.thumbStrip} onLayout={(e) => setStripHeight(e.nativeEvent.layout.height)}>
              {shots.map((shot, index) => (
                <View key={`${shot.uri}-${index}`} style={styles.thumbWrap}>
                  {shot.uri ? (
                    <Image source={{ uri: shot.uri }} style={styles.thumb} />
                  ) : (
                    <View style={styles.thumbEmpty} />
                  )}
                </View>
              ))}
              <Animated.View style={[styles.scanLine, { transform: [{ translateY }] }]} />
            </View>
            <Text style={styles.analyzeStatus}>{t('scout.cam.reviewing', { n: shots.length })}</Text>
            {classifying ? <Text style={styles.analyzeStatusSub}>{t('scout.cam.classifying')}</Text> : null}
          </View>
        )}
      </View>
    </Modal>
  )
}

/* ── Styles ────────────────────────────────────────────────────────────────── */

const makeStyles = (colors: Colors) =>
  createStyles({
    root: {
      flex: 1,
      backgroundColor: colors.black,
    },
    viewfinder: {
      flex: 1,
      backgroundColor: colors.black,
      overflow: 'hidden',
    },
    cameraPreview: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    },
    scene: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: colors.black,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sceneGlow: {
      position: 'absolute',
      width: 320,
      height: 320,
      borderRadius: 160,
      backgroundColor: `${colors.amber}12`,
    },
    sceneIcon: {
      width: 72,
      height: 72,
      borderRadius: 36,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.borderMid,
      alignItems: 'center',
      justifyContent: 'center',
    },
    scanLine: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 1,
      backgroundColor: colors.amber,
      opacity: 0.9,
    },
    doneOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(14,13,11,0.82)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    doneBadge: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: 'rgba(52,179,126,0.2)',
      borderWidth: 2,
      borderColor: colors.sage,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.md,
    },
    doneTitle: {
      fontSize: fontSizes.lg,
      fontWeight: fontWeights.bold,
      color: colors.sageLight,
      marginBottom: 4,
    },
    doneMeta: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xs,
      color: colors.textMuted,
    },
    doneBadgeWarn: {
      backgroundColor: 'rgba(242,163,64,0.16)',
      borderColor: colors.amber,
    },
    doneBadgeBang: {
      color: colors.amber,
      fontSize: fontSizes.xl,
      fontWeight: fontWeights.bold,
    },
    diagnosisLabel: {
      fontSize: fontSizes.xl,
      fontWeight: fontWeights.bold,
      color: colors.textPrimary,
      textAlign: 'center',
      marginBottom: 2,
    },
    diagnosisPlant: {
      fontSize: fontSizes.sm,
      color: colors.textSecondary,
      textAlign: 'center',
      marginBottom: 2,
    },
    diagnosisPathogen: {
      fontStyle: 'italic',
      fontSize: fontSizes.sm,
      color: colors.textSecondary,
      textAlign: 'center',
      marginBottom: 2,
    },
    diagnosisBotanical: {
      fontStyle: 'italic',
      color: colors.textMuted,
    },
    diagnosisConfidence: {
      fontFamily: 'monospace',
      fontSize: fontSizes.sm,
      color: colors.amber,
      marginBottom: spacing.sm,
    },
    diagnosisNotes: {
      fontSize: fontSizes.sm,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 18,
      marginBottom: spacing.md,
      paddingHorizontal: spacing.xl,
    },
    topBar: {
      position: 'absolute',
      top: 0,
      left: spacing.lg,
      right: spacing.lg,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
    },
    backBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: 'rgba(14,13,11,0.85)',
      borderRadius: radii.full,
      borderWidth: 1,
      borderColor: colors.borderHi,
      paddingVertical: spacing.sm,
      paddingLeft: 8,
      paddingRight: spacing.md,
    },
    backText: {
      color: colors.textPrimary,
      fontSize: fontSizes.md,
      fontWeight: fontWeights.semibold,
    },
    gpsChip: {
      backgroundColor: 'rgba(14,13,11,0.85)',
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: 'rgba(52,179,126,0.35)',
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      maxWidth: '58%',
    },
    gpsHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 3,
    },
    gpsDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.sage,
    },
    gpsDotPending: {
      backgroundColor: colors.textMuted,
    },
    gpsLabel: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xxs,
      color: colors.sageLight,
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    gpsCoord: {
      fontFamily: 'monospace',
      fontSize: fontSizes.sm,
      color: colors.textPrimary,
    },
    gpsAcc: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xxs,
      color: colors.textMuted,
      marginTop: 2,
    },
    permissionCard: {
      position: 'absolute',
      left: spacing.xl,
      right: spacing.xl,
      top: '38%',
      backgroundColor: 'rgba(14,13,11,0.92)',
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.borderHi,
      padding: spacing.lg,
      alignItems: 'center',
      gap: spacing.md,
    },
    permissionText: {
      fontSize: fontSizes.base,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 18,
    },
    permissionBtn: {
      backgroundColor: colors.amber,
      borderRadius: radii.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.lg,
    },
    permissionBtnText: {
      color: colors.surface,
      fontSize: fontSizes.md,
      fontWeight: fontWeights.bold,
    },
    previewBadge: {
      position: 'absolute',
      alignSelf: 'center',
      backgroundColor: 'rgba(14,13,11,0.72)',
      borderRadius: radii.full,
      borderWidth: 1,
      borderColor: colors.borderMid,
      paddingVertical: 5,
      paddingHorizontal: spacing.md,
    },
    previewBadgeText: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xxs,
      color: colors.textMuted,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
    },
    fieldLabel: {
      position: 'absolute',
      bottom: spacing.lg,
      alignSelf: 'center',
      backgroundColor: 'rgba(14,13,11,0.85)',
      borderRadius: radii.full,
      borderWidth: 1,
      borderColor: colors.borderMid,
      paddingVertical: 6,
      paddingHorizontal: spacing.lg,
    },
    fieldLabelText: {
      fontFamily: 'monospace',
      fontSize: fontSizes.sm,
      color: colors.amber,
    },
    controls: {
      backgroundColor: colors.surface,
      paddingTop: spacing.lg,
      paddingHorizontal: spacing['2xl'],
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    hint: {
      fontSize: fontSizes.xs,
      color: colors.textMuted,
      textAlign: 'center',
      marginBottom: spacing.md,
    },
    controlRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.surfaceAlt,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    chipText: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xs,
      color: colors.textMuted,
    },
    shutter: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: colors.amber,
      borderWidth: 3,
      borderColor: 'rgba(255,255,255,0.2)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    shutterDisabled: {
      opacity: 0.4,
    },
    analyzeBtn: {
      marginTop: spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      backgroundColor: colors.surfaceAlt,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: `${colors.amber}66`,
      paddingVertical: spacing.md,
    },
    analyzeText: {
      color: colors.amber,
      fontSize: fontSizes.md,
      fontWeight: fontWeights.bold,
    },
    shutterInner: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: 'rgba(255,255,255,0.15)',
    },
    actionRow: {
      flexDirection: 'row',
      gap: spacing.md,
    },
    retakeBtn: {
      flex: 1,
      paddingVertical: spacing.lg,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.borderMid,
      alignItems: 'center',
    },
    retakeText: {
      color: colors.textMuted,
      fontSize: fontSizes.md,
      fontWeight: fontWeights.semibold,
    },
    submitBtn: {
      flex: 2,
      paddingVertical: spacing.lg,
      borderRadius: radii.lg,
      backgroundColor: colors.amber,
      alignItems: 'center',
    },
    submitText: {
      color: colors.surface,
      fontSize: fontSizes.md,
      fontWeight: fontWeights.bold,
    },
    submitBusy: {
      opacity: 0.65,
    },
    submitError: {
      marginTop: spacing.md,
      fontSize: fontSizes.xs,
      lineHeight: 16,
      color: colors.dangerText,
      textAlign: 'center',
    },
    noFarmHint: {
      marginTop: spacing.md,
      fontSize: fontSizes.xs,
      color: colors.textMuted,
      textAlign: 'center',
    },
    gatedHint: {
      marginTop: spacing.md,
      fontSize: fontSizes.xs,
      lineHeight: 16,
      color: colors.textMuted,
      textAlign: 'center',
    },
    analyzeOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(14,13,11,0.94)',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.xl,
    },
    analyzeTitle: {
      fontSize: fontSizes.lg,
      fontWeight: fontWeights.bold,
      color: colors.textPrimary,
      marginBottom: spacing.lg,
    },
    thumbStrip: {
      flexDirection: 'row',
      gap: spacing.sm,
      padding: spacing.sm,
      marginBottom: spacing.lg,
      overflow: 'hidden',
      borderRadius: radii.md,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: 'rgba(242,163,64,0.4)',
    },
    thumbWrap: {
      width: 56,
      height: 56,
      borderRadius: radii.sm,
      overflow: 'hidden',
      backgroundColor: colors.surface,
    },
    thumb: {
      width: '100%',
      height: '100%',
    },
    thumbEmpty: {
      flex: 1,
      backgroundColor: colors.surfaceAlt,
    },
    analyzeStatus: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xs,
      color: colors.textMuted,
      textAlign: 'center',
    },
    analyzeStatusSub: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xxs,
      color: colors.amber,
      marginTop: spacing.xs,
      textAlign: 'center',
    },
  })
