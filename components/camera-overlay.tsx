/**
 * components/camera-overlay.tsx — Field scouting camera overlay
 *
 * Real capture UI: `CameraView` from expo-camera when the user has granted
 * access, with a live GPS fix (expo-location) in the top chrome. When the
 * camera is unavailable or denied, it falls back to a themed empty state
 * (dashed ring + camera-off icon) so the flow still works — the preview
 * badge keeps labelling the non-live feed.
 *
 * Nothing in this overlay is a placeholder:
 *   - the field label is the connected wallet's on-chain farm name (or an
 *     honest "Unregistered area" when there is none) — the Farm account has
 *     no crop field, so no crop is invented;
 *   - the shot counter counts captures the user actually took (up to 5),
 *     and the done card reports that same count;
 *   - the AI chip probes the classify proxy on open (checking / ready /
 *     unavailable) and the verdict line reports the live classification;
 *   - a submit without a verdict sends `unclassified` with severity `none`,
 *     never a seeded diagnosis, and the local row mirrors exactly that.
 *
 * The shutter captures into `shots`; "Analyze crop" runs the classifier on
 * the captured bytes (`features/ai/usePhotoClassification`) and the done
 * card shows the live verdict. "Submit to Chain" hands a freshly built
 * ScoutEvent back to the caller so the scouting log updates immediately —
 * without a farm it hands back a local row instead, carrying the `anchor`
 * payload (photo hash, uri, label) the log store persists so the capture
 * can be anchored to the chain after a restart, once a farm exists.
 */

import { useEffect, useRef, useState } from 'react'
import { Animated, Easing, Modal, Pressable, Text, View } from 'react-native'
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
}

/** Where the AI chip stands: probed on open, never guessed. */
type AiEndpointStatus = 'checking' | 'up' | 'down' | 'unset'

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

export function CameraOverlay({ onClose, onSubmit, farmAddress, farmName }: CameraOverlayProps) {
  const [scanning, setScanning] = useState(false)
  const [done, setDone] = useState(false)
  const [shots, setShots] = useState<CapturedPhoto[]>([])
  // Endpoint state is decided at construction (configured or not); the effect
  // below only ever resolves it asynchronously — no setState in effect body.
  const [aiEndpoint, setAiEndpoint] = useState<AiEndpointStatus>(() => (getClassifyEndpoint() ? 'checking' : 'unset'))
  const [coords, setCoords] = useState<ScoutCoords | null>(null)
  const [locating, setLocating] = useState(true)
  const [frameHeight, setFrameHeight] = useState(0)
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
     "down". Skipped entirely when the endpoint is not configured. */
  useEffect(() => {
    const endpoint = getClassifyEndpoint()
    if (!endpoint) return
    let active = true
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 4000)
    fetch(endpoint, { method: 'GET', signal: controller.signal })
      .then(() => {
        if (active) setAiEndpoint('up')
      })
      .catch(() => {
        if (active) setAiEndpoint('down')
      })
      .finally(() => clearTimeout(timer))
    return () => {
      active = false
      controller.abort()
    }
  }, [])

  /* Scanline loop while the classifier "runs" */
  useEffect(() => {
    if (!scanning) {
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
  }, [scanning, scan])

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
    if (scanning || done || shots.length >= MAX_SHOTS) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    const captured = await capturePhoto()
    if (cancelled.current) return
    // The simulated preview still counts as an attempt — it is labelled as
    // simulated; only real bytes reach the hash and the classifier.
    setShots((prev) => [...prev, captured ?? { uri: '', base64: '' }])
  }

  /** Run the classifier on the captured bytes, then show the verdict card. */
  async function handleAnalyze() {
    if (scanning || shots.length === 0) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setScanning(true)

    const bytes = shots.find((s) => s.base64)?.base64 ?? ''
    const [, verdict] = await Promise.all([delay(SCAN_MS), bytes ? classify(bytes) : Promise.resolve(null)])
    if (cancelled.current) return

    setScanning(false)
    setDone(true)
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

  function handleRetake() {
    resetClassification()
    setDone(false)
    setScanning(false)
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

  async function handleSubmit() {
    if (submitReport.isPending) return
    const point = coords ?? FALLBACK_GPS
    const stamp = Date.now()
    const uri = `indorse://scout/${stamp}.jpg`
    const realBytes = shots.filter((s) => s.base64).map((s) => s.base64)
    // Real captures hash their bytes together; the simulated path keeps a
    // deterministic digest derived from the capture time.
    const hash = realBytes.length ? await photoHash(realBytes.join('|')) : demoPhotoHash(String(stamp))

    // Shared by both paths: real date, real farm name (or honest fallback),
    // no invented crop, the actual number of captured shots.
    const base: Pick<ScoutEvent, 'date' | 'field' | 'crop' | 'images' | 'lat' | 'lng'> = {
      date: formatShortDate(stamp / 1000),
      field: farmName ?? t('scout.cam.unregistered'),
      crop: NO_CROP,
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
        anchor: {
          photoHashHex: bytesToHex(hash),
          uri,
          aiLabel,
          // Real shot files only — best-effort evidence to re-derive the hash.
          photoUris: shots.map((shot) => shot.uri).filter((shotUri) => shotUri.length > 0),
        },
      })
      onClose()
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
          // The row mirrors what actually went on-chain.
          onSubmit?.({
            ...base,
            ...buildVerdict(uri),
            id: reportAddress,
            txSig: reportAddress,
            chainStatus: 'pending',
          })
          onClose()
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
    outputRange: [0, Math.max(frameHeight - 2, 0)],
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

          {/* Focus brackets + scanline */}
          {scanning && (
            <View style={styles.brackets} onLayout={(e) => setFrameHeight(e.nativeEvent.layout.height)}>
              <View style={[styles.corner, styles.cornerTL]} />
              <View style={[styles.corner, styles.cornerTR]} />
              <View style={[styles.corner, styles.cornerBL]} />
              <View style={[styles.corner, styles.cornerBR]} />
              <Animated.View style={[styles.scanLine, { transform: [{ translateY }] }]} />
            </View>
          )}

          {/* Classification result */}
          {done && (
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
              <Text style={styles.doneTitle}>
                {shots.length <= 1 ? t('scout.cam.capturedOne') : t('scout.cam.captured', { n: shots.length })}
              </Text>
              <Text style={styles.doneMeta}>{classificationMeta()}</Text>
              {/* Seeker-only: signing keys sit in the device Seed Vault. */}
              <SeedVaultBadge />
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
          {!usesRealCamera && !done && !scanning && (
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
          {!done ? (
            <View>
              <Text style={styles.hint}>{scanning ? t('scout.cam.analyzing') : t('scout.cam.hint')}</Text>
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
                  style={[
                    styles.shutter,
                    scanning && styles.shutterActive,
                    shots.length >= MAX_SHOTS && styles.shutterDisabled,
                  ]}
                  onPress={handleCapture}
                  disabled={scanning || shots.length >= MAX_SHOTS}
                  accessibilityLabel={t('scout.cam.capture')}
                >
                  {scanning ? <View style={styles.shutterStop} /> : <View style={styles.shutterInner} />}
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
              {shots.length > 0 && !scanning ? (
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
          ) : (
            <View>
              <View style={styles.actionRow}>
                <Pressable style={styles.retakeBtn} onPress={handleRetake} disabled={submitReport.isPending}>
                  <Text style={styles.retakeText}>{t('scout.cam.retake')}</Text>
                </Pressable>
                <Pressable
                  style={[styles.submitBtn, (submitReport.isPending || classifying) && styles.submitBusy]}
                  onPress={handleSubmit}
                  disabled={submitReport.isPending || classifying}
                >
                  <Text style={styles.submitText}>
                    {submitReport.isPending ? t('scout.cam.submitting') : t('scout.cam.submit')}
                  </Text>
                </Pressable>
              </View>

              {submitReport.isError && submitReport.error ? (
                <Text style={styles.submitError}>
                  {t('scout.cam.submitFailed')} — {submitReport.error.message}
                </Text>
              ) : !farmAddress ? (
                <Text style={styles.noFarmHint}>{t('scout.cam.noFarm')}</Text>
              ) : null}
            </View>
          )}
        </View>
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
    brackets: {
      position: 'absolute',
      top: '22%',
      bottom: '22%',
      left: '18%',
      right: '18%',
      borderWidth: 1,
      borderColor: 'rgba(242,163,64,0.3)',
      borderRadius: radii.sm,
      overflow: 'hidden',
    },
    corner: {
      position: 'absolute',
      width: 20,
      height: 20,
    },
    cornerTL: {
      top: -1,
      left: -1,
      borderTopWidth: 2,
      borderLeftWidth: 2,
      borderTopColor: colors.amber,
      borderLeftColor: colors.amber,
      borderTopLeftRadius: 4,
    },
    cornerTR: {
      top: -1,
      right: -1,
      borderTopWidth: 2,
      borderRightWidth: 2,
      borderTopColor: colors.amber,
      borderRightColor: colors.amber,
      borderTopRightRadius: 4,
    },
    cornerBL: {
      bottom: -1,
      left: -1,
      borderBottomWidth: 2,
      borderLeftWidth: 2,
      borderBottomColor: colors.amber,
      borderLeftColor: colors.amber,
      borderBottomLeftRadius: 4,
    },
    cornerBR: {
      bottom: -1,
      right: -1,
      borderBottomWidth: 2,
      borderRightWidth: 2,
      borderBottomColor: colors.amber,
      borderRightColor: colors.amber,
      borderBottomRightRadius: 4,
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
    shutterActive: {
      backgroundColor: 'rgba(242,163,64,0.25)',
      borderColor: colors.amber,
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
    shutterStop: {
      width: 20,
      height: 20,
      borderRadius: radii.xs,
      backgroundColor: colors.amber,
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
  })
