/**
 * app/(tabs)/index.tsx — Scouting Screen
 *
 * Summary tiles, per-field risk status, the scouting log with expandable
 * detail rows, and the docked action stack — "Scout Field" over "Register
 * farm" — fixed just above the tab bar.
 *
 * Entry state: when the operator has not added any farm (no on-chain farm,
 * nothing in the local registry), the setup card (ScoutOnboarding) replaces
 * the dashboard — and the docked pills with it. Its info card opens the
 * camera, so scouting works before setup; only anchoring needs a farm.
 *
 * The log is chain-aware:
 *   - wallet connected + farm registered → reports read from the chain
 *     (`useReportsQuery`, newest first), rows carry their review status
 *   - wallet connected, farm local-only  → register-farm empty state
 *   - not connected / no reports yet     → empty states (no seeded samples)
 *
 * Locally captured rows come from ScoutLogProvider (`indorse.scout.v1`):
 * they survive a restart, and merge optimistically with the fetched ones,
 * deduped by report address, so the refetch after a submit cannot
 * double-render a row. A capture taken before a farm existed carries an
 * `anchor` payload; once a registered farm is reachable, the outbox flush
 * below anchors each queued row — one wallet transaction at a time, in
 * capture order — or parks it as `failed` for an explicit retry.
 */

import { useEffect, useRef, useState } from 'react'
import { Animated, Easing, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import Svg, { Circle, Path } from 'react-native-svg'
import * as Haptics from 'expo-haptics'
import { CameraOverlay } from '@/components/camera-overlay'
import { ConfirmModal } from '@/components/confirm-modal'
import { RegisterFarmModal } from '@/components/register-farm-modal'
import { ScoutOnboarding } from '@/components/scout-onboarding'
import { ScoutPhotoStrip } from '@/components/scout-photo-strip'
import { useFarmRegistry } from '@/components/farm-registry-provider'
import { useScoutLog } from '@/components/scout-log-provider'
import {
  Banner,
  Chip,
  EmptyState,
  ErrorState,
  RiskBar,
  SectionLabel,
  SeverityPill,
  Skeleton,
} from '@/components/screen-kit'
import { useTheme } from '@/components/theme-provider'
import { createStyles, fieldStatusFor, fontSizes, fontWeights, radii, spacing, type Colors } from '@/constants/theme'
import type { ScoutEvent, Field } from '@/constants/data'
import { useMobileWalletSetup } from '@/features/wallet/useMobileWalletSetup'
import { useFarmQuery } from '@/features/farm/useFarmQuery'
import { useReportsQuery } from '@/features/reports/useReportsQuery'
import { useRewardReport } from '@/features/reports/useRewardReport'
import { useSubmitReport } from '@/features/reports/useSubmitReport'
import { mergeLogEvents, reportToScoutEvent } from '@/features/reports/chain-events'
import { buildFieldsFromReports } from '@/features/scout/fields'
import { sha256HexToBytes } from '@/features/scout/photo'
import { useT, type MessageKey } from '@/lib/i18n'

const STATUS_KEYS = {
  pending: 'scout.status.pending',
  verified: 'scout.status.verified',
  rejected: 'scout.status.rejected',
  rewarded: 'scout.status.rewarded',
} as const satisfies Record<string, MessageKey>

export default function ScoutingScreen() {
  const log = useScoutLog()
  const [expanded, setExpanded] = useState<string | null>(null)
  // One pending row-level delete at a time, gated behind ConfirmModal — a
  // mis-tap should not wipe a capture (and its photos) off the device.
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  // Scroll-to-log: a fresh capture should be SEEN, not only counted. The
  // log block reports its content-offset via onLayout; a new event scrolls
  // the view there one frame later (after React commits the new row).
  const scrollRef = useRef<ScrollView>(null)
  const logSectionY = useRef(0)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [registerOpen, setRegisterOpen] = useState(false)
  // The docked stack folds behind one circular button. `actionsOpen` is the
  // source of truth for interaction (it gates pointerEvents), while `unfold`
  // only drives the visual reveal — keeping them separate means the fold can
  // animate without ever unmounting a pill.
  const [actionsOpen, setActionsOpen] = useState(false)
  const [unfold] = useState(() => new Animated.Value(0))
  const { address, toggleConnection } = useMobileWalletSetup()
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const t = useT()

  const farmQuery = useFarmQuery()
  const farm = farmQuery.farm
  const registry = useFarmRegistry()
  const reportsQuery = useReportsQuery(
    farm && farmQuery.farmAddress ? { address: farmQuery.farmAddress, reportCount: farm.reportCount } : null,
  )
  // Claiming is permissionless — the program pins the payout to the report's
  // own reporter — so the row offers it to whoever is looking at it.
  const claimReward = useRewardReport()

  const connected = !!address
  const onChain = connected && farmQuery.state === 'ready' && !!farm
  const registerPrompt = connected && farmQuery.state === 'ready' && !farm
  const readFailed = connected && farmQuery.state === 'error'
  const reportsFailed = onChain && reportsQuery.state === 'error'
  // Entry state — no farm anywhere (chain or local registry): the setup card
  // takes over the whole screen, docked pills included.
  const hasFarmAnywhere = !!farm || registry.farms.length > 0

  const baseEvents: ScoutEvent[] =
    onChain && farm ? reportsQuery.reports.map((report) => reportToScoutEvent(report, farm)) : []
  const events = mergeLogEvents(log.events, baseEvents)

  // Field cards follow the same source as the log: chain when the farm is
  // registered, empty otherwise — the empty states below carry no data.
  const fields: Field[] = onChain && farm ? buildFieldsFromReports(reportsQuery.reports, farm.name) : []

  const alerts = fields.filter((f) => f.status !== 'clean').length
  const worstField = fields.filter((f) => f.status !== 'clean').sort((a, b) => b.risk - a.risk)[0]

  function openCamera() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setCameraOpen(true)
  }

  function foldActions() {
    setActionsOpen(false)
    Animated.timing(unfold, {
      toValue: 0,
      duration: 180,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start()
  }

  function toggleActions() {
    Haptics.selectionAsync()
    const opening = !actionsOpen
    setActionsOpen(opening)
    Animated.timing(unfold, {
      toValue: opening ? 1 : 0,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start()
  }

  // One value drives the whole fold. Register sits nearest the circle so it
  // lands first and Scout follows — the stack reads as unfolding upward out of
  // the button rather than two pills fading in together. Clamping keeps each
  // pill parked at its start value before the fold begins.
  const registerReveal = unfold.interpolate({ inputRange: [0, 0.7], outputRange: [0, 1], extrapolate: 'clamp' })
  const registerRise = unfold.interpolate({ inputRange: [0, 0.7], outputRange: [10, 0], extrapolate: 'clamp' })
  const scoutReveal = unfold.interpolate({ inputRange: [0.3, 1], outputRange: [0, 1], extrapolate: 'clamp' })
  const scoutRise = unfold.interpolate({ inputRange: [0.3, 1], outputRange: [10, 0], extrapolate: 'clamp' })
  // The plus turns into a close mark as the stack opens.
  const plusTurn = unfold.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] })

  function toggleEvent(id: string) {
    Haptics.selectionAsync()
    setExpanded((current) => (current === id ? null : id))
  }

  function handleNewEvent(event: ScoutEvent) {
    // The store derives the anchoring lifecycle (queued / anchored) from
    // what the capture actually carries and persists it immediately.
    log.add(event)
    setExpanded(event.id)
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: Math.max(logSectionY.current - 72, 0), animated: true })
    })
  }

  /* ── Outbox flush ────────────────────────────────────────────────────
   * Queued captures anchor themselves as soon as there is a farm to anchor
   * them to — one wallet transaction per row, in capture order. A failed
   * attempt parks the row as `failed` (payload kept) for an explicit retry
   * from its detail row: nothing loops silently, nothing is ever dropped.
   * `flushTick` re-runs the pass for captures queued while it was running;
   * the drained count is what stops it. */
  const queuedCount = log.events.filter((event) => event.anchorStatus === 'queued' && event.anchor).length
  const [flushTick, setFlushTick] = useState(0)
  const flushingRef = useRef(false)
  const { mutateAsync } = useSubmitReport()
  const farmAddress = farmQuery.farmAddress
  const farmName = farm?.name ?? null

  useEffect(() => {
    if (!onChain || !farmAddress || !farmName || queuedCount === 0 || flushingRef.current) return
    const queue = log.events.filter((event) => event.anchorStatus === 'queued' && event.anchor)
    flushingRef.current = true
    void (async () => {
      for (const event of queue) {
        const payload = event.anchor
        if (!payload) continue
        try {
          const reportAddress = await mutateAsync({
            farmAddress,
            photoHash: sha256HexToBytes(payload.photoHashHex),
            uri: payload.uri,
            lat: event.lat,
            lng: event.lng,
            aiLabel: payload.aiLabel,
          })
          log.markAnchored(event.id, { reportAddress, field: farmName })
        } catch {
          log.markFailed(event.id)
        }
      }
      flushingRef.current = false
      setFlushTick((tick) => tick + 1)
    })()
  }, [onChain, farmAddress, farmName, queuedCount, flushTick, log, mutateAsync])

  const showSkeleton = connected && (farmQuery.state === 'loading' || (onChain && reportsQuery.state === 'loading'))

  if (showSkeleton) return <ScoutingSkeleton />
  if (readFailed) return <ScoutingError onRetry={farmQuery.retry} />

  // No farm anywhere yet — the setup card replaces the dashboard and the
  // docked pills with it. Scanning still works: the info card opens the
  // camera, whose captures stay local until there is a farm to anchor them.
  if (!hasFarmAnywhere) {
    return (
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={styles.onboard} showsVerticalScrollIndicator={false}>
          <ScoutOnboarding
            connected={connected}
            farmDone={!!farm}
            onConnect={() => {
              Haptics.selectionAsync()
              toggleConnection()
            }}
            onRegister={() => {
              Haptics.selectionAsync()
              setRegisterOpen(true)
            }}
            onScan={openCamera}
          />
        </ScrollView>

        {cameraOpen && (
          <CameraOverlay
            onClose={() => setCameraOpen(false)}
            onSubmit={handleNewEvent}
            farmAddress={null}
            farmName={null}
          />
        )}

        {registerOpen && <RegisterFarmModal onClose={() => setRegisterOpen(false)} />}
      </View>
    )
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        /* Pull-to-refresh re-reads both chain queries; the spinner is driven
           by react-query's real fetch state, so it shows only while a fetch
           is actually in flight (and never when the query is disabled). */
        refreshControl={
          <RefreshControl
            refreshing={farmQuery.isFetching || reportsQuery.isFetching}
            onRefresh={() => {
              farmQuery.retry()
              reportsQuery.retry()
            }}
            colors={[colors.amber]}
            tintColor={colors.amber}
          />
        }
      >
        {/* ── Summary tiles ─────────────────────────────────────── */}
        <View style={styles.tiles}>
          {[
            { label: t('scout.tile.events'), value: events.length, color: colors.textPrimary },
            { label: t('scout.tile.alerts'), value: alerts, color: colors.dangerText },
            { label: t('scout.tile.fields'), value: fields.length, color: colors.textPrimary },
          ].map((s) => (
            <View key={s.label} style={styles.tile}>
              <Text style={styles.tileLabel}>{s.label}</Text>
              <Text style={[styles.tileValue, { color: s.color }]}>{s.value}</Text>
            </View>
          ))}
        </View>

        {/* ── Attention banner — only over real chain fields; with no
            data there is nothing we could honestly call "clear" ──── */}
        {alerts > 0 && worstField ? (
          <Banner
            tone="danger"
            title={t('scout.banner.attention', { n: alerts })}
            message={t('scout.banner.attentionBody', {
              field: worstField.name,
              risk: Math.round(worstField.risk * 100),
            })}
            actionLabel={t('scout.bannerAction')}
            onAction={openCamera}
            style={styles.bannerAfterTiles}
          />
        ) : fields.length > 0 ? (
          <Banner
            tone="success"
            title={t('scout.banner.clear')}
            message={t('scout.banner.clearBody')}
            style={styles.bannerAfterTiles}
          />
        ) : null}

        {/* ── Field status ──────────────────────────────────────── */}
        <View style={styles.block}>
          <SectionLabel>{t('scout.fields')}</SectionLabel>
          {fields.length === 0 ? (
            <EmptyState title={t('scout.empty.fields')} message={t('scout.empty.fieldsBody')} />
          ) : (
            <View style={styles.stack}>
              {fields.map((f) => {
                const status: { color: string; label: string } = fieldStatusFor(colors)[f.status]
                return (
                  <View key={f.id} style={styles.fieldCard}>
                    <View style={[styles.fieldRail, { backgroundColor: status.color }]} />
                    <View style={styles.fieldBody}>
                      <View style={styles.fieldTop}>
                        <Text style={styles.fieldName} numberOfLines={1}>
                          {f.name}
                        </Text>
                        <Chip label={status.label} color={status.color} filled />
                      </View>
                      {/* Chain-derived zones carry no acreage/crop — the meta
                          line only renders when there is something to say. */}
                      {f.acres > 0 || f.crop !== '—' ? (
                        <Text style={styles.fieldMeta}>{f.acres > 0 ? `${f.crop} · ${f.acres} ac` : f.crop}</Text>
                      ) : null}
                      <View style={styles.fieldRisk}>
                        <RiskBar value={f.risk} />
                      </View>
                    </View>
                  </View>
                )
              })}
            </View>
          )}
        </View>

        {/* ── Scouting log ──────────────────────────────────────── */}
        <View
          style={styles.block}
          onLayout={(e) => {
            logSectionY.current = e.nativeEvent.layout.y
          }}
        >
          <SectionLabel>{t('scout.log', { n: events.length })}</SectionLabel>

          {registerPrompt ? (
            <EmptyState
              title={t('scout.register.title')}
              message={t('scout.register.body')}
              actionLabel={t('scout.register.action')}
              onAction={() => setRegisterOpen(true)}
            />
          ) : reportsFailed ? (
            <ErrorState
              title={t('scout.chain.error')}
              message={t('scout.chain.errorBody')}
              retryLabel={t('scout.chain.retry')}
              onRetry={reportsQuery.retry}
            />
          ) : (
            <>
              {/* No "nothing here yet" claim until the stored log has been
                  read — a returning farmer's rows may still be hydrating. */}
              {log.ready && events.length === 0 ? (
                <EmptyState
                  title={t('scout.empty.log')}
                  message={t('scout.empty.logBody')}
                  actionLabel={t('scout.fab')}
                  onAction={openCamera}
                />
              ) : null}
              <View style={styles.stack}>
                {events.map((ev) => {
                  const isOpen = expanded === ev.id
                  // Rows on-chain (or cached from one) show anchored facts;
                  // queued/failed captures are honest about being local only.
                  const anchoredRow = !!ev.chainStatus || ev.anchorStatus === 'anchored'
                  const pillStyle =
                    ev.anchorStatus === 'queued'
                      ? { backgroundColor: colors.amberDim, borderColor: colors.amber, color: colors.amber }
                      : { backgroundColor: colors.dangerDim, borderColor: colors.danger, color: colors.dangerText }
                  return (
                    <Pressable
                      key={ev.id}
                      onPress={() => toggleEvent(ev.id)}
                      style={[styles.eventCard, isOpen && styles.eventCardOpen]}
                    >
                      <View style={styles.eventHeader}>
                        <View style={styles.eventHeaderMain}>
                          <View style={styles.eventTags}>
                            {ev.chainStatus ? null : <SeverityPill severity={ev.severity} />}
                            {ev.anchorStatus === 'queued' || ev.anchorStatus === 'failed' ? (
                              <View
                                style={[
                                  styles.anchorPill,
                                  { backgroundColor: pillStyle.backgroundColor, borderColor: pillStyle.borderColor },
                                ]}
                              >
                                <Text style={[styles.anchorPillText, { color: pillStyle.color }]}>
                                  {t(ev.anchorStatus === 'queued' ? 'scout.anchor.queued' : 'scout.anchor.failed')}
                                </Text>
                              </View>
                            ) : null}
                            <Text style={styles.eventDate}>{ev.date}</Text>
                          </View>
                          <Text style={styles.eventDiagnosis}>{ev.diagnosis}</Text>
                          <Text style={styles.eventMeta}>
                            {ev.field} · {ev.crop}
                          </Text>
                        </View>
                        {ev.chainStatus ? (
                          <View style={[styles.statusPill, statusPalette(ev.chainStatus, colors).pill]}>
                            <Text style={[styles.statusPillText, statusPalette(ev.chainStatus, colors).text]}>
                              {t(STATUS_KEYS[ev.chainStatus])}
                            </Text>
                          </View>
                        ) : (
                          <View style={styles.eventConfidence}>
                            <Text style={styles.eventConfidenceLabel}>{t('scout.conf')}</Text>
                            <Text
                              style={[
                                styles.eventConfidenceValue,
                                {
                                  color:
                                    ev.confidence > 0.85
                                      ? colors.sageLight
                                      : ev.confidence > 0.65
                                        ? colors.warningText
                                        : colors.skyLight,
                                },
                              ]}
                            >
                              {Math.round(ev.confidence * 100)}%
                            </Text>
                          </View>
                        )}
                      </View>

                      {isOpen && (
                        <View style={styles.eventDetail}>
                          <Text style={styles.eventNotes}>{ev.notes}</Text>

                          <View style={styles.gpsRow}>
                            <Svg width={12} height={12} viewBox="0 0 12 12" fill="none">
                              <Circle cx={6} cy={5} r={2.5} stroke={colors.sage} strokeWidth={1.2} />
                              <Path d="M6 7.5L6 11" stroke={colors.sage} strokeWidth={1.2} strokeLinecap="round" />
                            </Svg>
                            <Text style={styles.gpsText}>
                              {ev.lat.toFixed(4)}° N, {Math.abs(ev.lng).toFixed(4)}° W
                            </Text>
                          </View>

                          <View style={styles.detailRow}>
                            <View>
                              <Text style={styles.detailLabel}>{t('scout.images')}</Text>
                              <Text style={styles.detailValue}>
                                {t(anchoredRow ? 'scout.imagesAnchored' : 'scout.imagesCaptured', { n: ev.images })}
                              </Text>
                            </View>
                            {ev.chainStatus ? null : (
                              <View>
                                <Text style={styles.detailLabel}>{t('scout.model')}</Text>
                                <Text style={[styles.detailValue, { color: colors.sageLight }]}>PlantNet-v4.2</Text>
                              </View>
                            )}
                          </View>

                          {/* The evidence itself — thumbnails from the
                              capture's persisted pixels (kept across
                              anchoring); tap for the full-screen viewer. */}
                          <ScoutPhotoStrip uris={ev.photoUris ?? []} />

                          <Text style={styles.detailLabel}>
                            {anchoredRow ? t('scout.pda') : ev.anchor ? t('scout.photoDigest') : t('scout.tx')}
                          </Text>
                          <Text style={styles.txSig}>{ev.txSig}</Text>

                          {ev.anchorStatus === 'failed' ? (
                            <Pressable
                              style={styles.anchorRetry}
                              onPress={() => {
                                Haptics.selectionAsync()
                                log.requeue(ev.id)
                              }}
                              accessibilityRole="button"
                              accessibilityLabel={t('scout.anchor.retry')}
                            >
                              <Text style={styles.anchorRetryText}>{t('scout.anchor.retry')}</Text>
                            </Pressable>
                          ) : null}

                          {/* `Verified` is exactly the program's precondition
                              for `reward_report`, and `ev.id` is the report
                              address — the identity every chain row carries. */}
                          {ev.chainStatus === 'verified' ? (
                            <Pressable
                              style={[styles.anchorRetry, claimReward.isPending ? { opacity: 0.6 } : null]}
                              disabled={claimReward.isPending}
                              onPress={() => {
                                Haptics.selectionAsync()
                                claimReward.mutate(ev.id)
                              }}
                              accessibilityRole="button"
                              accessibilityLabel={t('scout.reward.claim')}
                            >
                              <Text style={styles.anchorRetryText}>
                                {claimReward.isPending ? t('scout.reward.claiming') : t('scout.reward.claim')}
                              </Text>
                            </Pressable>
                          ) : null}
                          {/* Scoped by the input the mutation ran with, so a
                              failure on one claim can't bleed into another. */}
                          {claimReward.isError && claimReward.variables === ev.id ? (
                            <Text style={styles.claimError}>
                              {claimReward.error instanceof Error
                                ? claimReward.error.message
                                : String(claimReward.error)}
                            </Text>
                          ) : null}

                          {/* Only rows the local store actually holds: a
                              chain-read row has nothing here to erase, and
                              offering the tap would be a lie. Deleting a
                              device-anchored row strips the local copy —
                              the chain's own record re-surfaces from the
                              fetch, exactly as the confirm promises. */}
                          {log.events.some((row) => row.id === ev.id) ? (
                            <Pressable
                              style={styles.deleteBtn}
                              onPress={() => {
                                Haptics.selectionAsync()
                                setPendingDelete(ev.id)
                              }}
                              accessibilityRole="button"
                              accessibilityLabel={t('scout.deleteRow')}
                            >
                              <Text style={styles.deleteBtnText}>{t('scout.deleteRow')}</Text>
                            </Pressable>
                          ) : null}
                        </View>
                      )}
                    </Pressable>
                  )
                })}
              </View>
            </>
          )}
        </View>
      </ScrollView>

      {/* ── Docked action stack ────────────────────────────────────── */}
      {/* Fixed just above the tab bar. The two actions now fold behind one
          circular button: tap it to unfold the pills, tap it again — or act
          on one — to fold them back. The pills stay mounted while folded and
          are gated by pointerEvents instead, so the fold animates rather than
          remounting, and screen readers keep a stable order either way. The
          modal's only other entry point is the connected-unregistered empty
          state, so this is what makes it reachable for everyone. `box-none`
          keeps the gap between the circle and the content scrollable. */}
      <View style={styles.fabStack} pointerEvents="box-none" testID="scout-actions">
        <Animated.View style={styles.fabActions} pointerEvents={actionsOpen ? 'auto' : 'none'}>
          <Animated.View style={{ opacity: scoutReveal, transform: [{ translateY: scoutRise }] }}>
            <Pressable
              style={styles.fab}
              onPress={() => {
                foldActions()
                openCamera()
              }}
              accessibilityRole="button"
              accessibilityLabel="Scout field"
            >
              <Svg width={14} height={14} viewBox="0 0 14 14" fill="none">
                <Path
                  d="M2 4.5C2 3.4 2.9 2.5 4 2.5h.5l1-1.5h3l1 1.5H10c1.1 0 2 .9 2 2v5c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2v-5z"
                  stroke={colors.surface}
                  strokeWidth={1.3}
                  fill="none"
                />
                <Circle cx={7} cy={7} r={1.8} stroke={colors.surface} strokeWidth={1.3} fill="none" />
              </Svg>
              <Text style={styles.fabText}>{t('scout.fab')}</Text>
            </Pressable>
          </Animated.View>

          <Animated.View style={{ opacity: registerReveal, transform: [{ translateY: registerRise }] }}>
            <Pressable
              style={styles.fabSecondary}
              onPress={() => {
                foldActions()
                Haptics.selectionAsync()
                setRegisterOpen(true)
              }}
              accessibilityRole="button"
              accessibilityLabel={t('scout.register.action')}
            >
              <Svg width={14} height={14} viewBox="0 0 14 14" fill="none">
                <Path d="M7 2.75v8.5M2.75 7h8.5" stroke={colors.amber} strokeWidth={1.5} strokeLinecap="round" />
              </Svg>
              <Text style={styles.fabSecondaryText}>{t('scout.register.action')}</Text>
            </Pressable>
          </Animated.View>
        </Animated.View>

        <Pressable
          style={styles.fabCircle}
          onPress={toggleActions}
          accessibilityRole="button"
          accessibilityLabel={t('scout.actions')}
          accessibilityState={{ expanded: actionsOpen }}
          hitSlop={8}
        >
          <Animated.View style={{ transform: [{ rotate: plusTurn }] }}>
            <Svg width={22} height={22} viewBox="0 0 14 14" fill="none">
              <Path d="M7 2.4v9.2M2.4 7h9.2" stroke={colors.surface} strokeWidth={1.7} strokeLinecap="round" />
            </Svg>
          </Animated.View>
        </Pressable>
      </View>

      {cameraOpen && (
        <CameraOverlay
          onClose={() => setCameraOpen(false)}
          onSubmit={handleNewEvent}
          farmAddress={farm && onChain ? farmQuery.farmAddress : null}
          farmName={farm?.name ?? null}
        />
      )}

      {registerOpen && <RegisterFarmModal onClose={() => setRegisterOpen(false)} />}

      {/* Destructive and device-local: ConfirmModal gates the tap, and its
          lead is honest about what deletion can and cannot reach. */}
      {pendingDelete && (
        <ConfirmModal
          title={t('scout.deleteTitle')}
          lead={t('scout.deleteBody')}
          confirmLabel={t('scout.deleteConfirm')}
          danger
          requireWallet={false}
          onConfirm={() => {
            log.remove(pendingDelete)
          }}
          onClose={() => setPendingDelete(null)}
          testID="scout-delete-confirm"
        />
      )}
    </View>
  )
}

/* ── Status pill palette (chain rows) ──────────────────────────────────────── */

function statusPalette(
  status: NonNullable<ScoutEvent['chainStatus']>,
  colors: Colors,
): { pill: { backgroundColor: string; borderColor: string }; text: { color: string } } {
  switch (status) {
    case 'verified':
      return { pill: { backgroundColor: colors.sageDim, borderColor: colors.sage }, text: { color: colors.sage } }
    case 'rejected':
      return {
        pill: { backgroundColor: colors.dangerDim, borderColor: colors.danger },
        text: { color: colors.dangerText },
      }
    case 'rewarded':
      return { pill: { backgroundColor: colors.skyDim, borderColor: colors.sky }, text: { color: colors.sky } }
    default:
      return { pill: { backgroundColor: colors.amberDim, borderColor: colors.amber }, text: { color: colors.amber } }
  }
}

/* ── Loading skeleton ───────────────────────────────────────────────────────── */

function ScoutingSkeleton() {
  const styles = makeStyles(useTheme().colors)
  return (
    <View style={styles.screen}>
      <View style={styles.content}>
        <View style={styles.tiles}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.tile}>
              <Skeleton height={9} width="55%" />
              <Skeleton height={24} width="45%" style={{ marginTop: spacing.sm }} />
            </View>
          ))}
        </View>

        <View style={styles.block}>
          <Skeleton height={9} width={110} />
          <View style={[styles.stack, { marginTop: spacing.md }]}>
            {[0, 1].map((i) => (
              <View key={i} style={styles.fieldCard}>
                <View style={styles.fieldRail} />
                <View style={styles.fieldBody}>
                  <Skeleton height={13} width="60%" />
                  <Skeleton height={10} width="40%" style={{ marginTop: spacing.sm }} />
                  <Skeleton height={4} style={{ marginTop: spacing.md }} />
                </View>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.block}>
          <Skeleton height={9} width={150} />
          <View style={[styles.stack, { marginTop: spacing.md }]}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.eventCard}>
                <View style={styles.skeletonCard}>
                  <Skeleton height={15} width="70%" />
                  <Skeleton height={10} width="45%" />
                  <Skeleton height={9} width="85%" />
                </View>
              </View>
            ))}
          </View>
        </View>
      </View>
    </View>
  )
}

/* ── Chain read failure ─────────────────────────────────────────────────────── */

function ScoutingError({ onRetry }: { onRetry: () => void }) {
  const styles = makeStyles(useTheme().colors)
  const t = useT()
  return (
    <View style={styles.screen}>
      <View style={styles.content}>
        <ErrorState
          title={t('scout.chain.error')}
          message={t('scout.chain.errorBody')}
          retryLabel={t('scout.chain.retry')}
          onRetry={onRetry}
        />
      </View>
    </View>
  )
}

/* ── Styles ────────────────────────────────────────────────────────────────── */

const makeStyles = (colors: Colors) =>
  createStyles({
    screen: {
      flex: 1,
      backgroundColor: colors.surface,
    },
    content: {
      padding: spacing.lg,
      // Clears the folded stack (circle + offset ≈ 72) with room to spare.
      // While unfolded the pills overlay scrolled content — normal for a FAB,
      // and transient since the fold closes as soon as an action is taken.
      paddingBottom: 128,
    },
    // Setup-card entry: no dock to clear, centered like a welcome screen.
    onboard: {
      flexGrow: 1,
      justifyContent: 'center',
      padding: spacing.lg,
    },
    tiles: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    bannerAfterTiles: {
      marginTop: spacing.md,
    },
    tile: {
      flex: 1,
      backgroundColor: colors.surfaceAlt,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md,
    },
    tileLabel: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xxs,
      color: colors.textDim,
      letterSpacing: 1.5,
      textTransform: 'uppercase',
      marginBottom: 4,
    },
    tileValue: {
      fontSize: fontSizes['4xl'],
      fontWeight: fontWeights.bold,
      lineHeight: 28,
    },
    block: {
      marginTop: spacing.lg,
    },
    stack: {
      gap: 6,
    },

    // Field status
    fieldCard: {
      flexDirection: 'row',
      backgroundColor: colors.surfaceAlt,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    // Status-coloured rail so field state reads at a glance while scrolling.
    fieldRail: {
      width: 3,
    },
    fieldBody: {
      flex: 1,
      padding: spacing.md + 2,
    },
    fieldTop: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginBottom: 5,
    },
    fieldName: {
      flex: 1,
      fontSize: fontSizes.lg,
      fontWeight: fontWeights.semibold,
      color: colors.textPrimary,
    },
    fieldMeta: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xs,
      color: colors.textMuted,
      marginBottom: spacing.sm,
    },
    fieldRisk: {
      marginTop: 2,
    },

    // Scouting log
    eventCard: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    eventCardOpen: {
      borderColor: `${colors.amber}80`,
    },
    eventHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
      padding: spacing.md + 2,
    },
    eventHeaderMain: {
      flex: 1,
      minWidth: 0,
    },
    eventTags: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 6,
    },
    eventDate: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xs,
      color: colors.textMuted,
    },
    eventDiagnosis: {
      fontSize: fontSizes.lg,
      fontWeight: fontWeights.semibold,
      color: colors.textPrimary,
      marginBottom: 2,
    },
    eventMeta: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xs,
      color: colors.textDim,
    },
    statusPill: {
      borderRadius: radii.full,
      borderWidth: 1,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
      alignSelf: 'flex-start',
    },
    statusPillText: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xxs,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    // Anchoring state for local rows — amber while queued (waiting for a
    // farm), red once an attempt failed. Colours inline: two states, one style.
    anchorPill: {
      borderRadius: radii.full,
      borderWidth: 1,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
    },
    anchorPillText: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xxs,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    // Explicit retry for a failed anchor — never a silent re-attempt loop.
    anchorRetry: {
      marginTop: spacing.md,
      alignSelf: 'flex-start',
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: `${colors.amber}66`,
      backgroundColor: colors.surfaceAlt,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    anchorRetryText: {
      color: colors.amber,
      fontSize: fontSizes.sm,
      fontWeight: fontWeights.semibold,
    },
    claimError: {
      marginTop: spacing.xs,
      color: colors.dangerText,
      fontSize: fontSizes.sm,
      lineHeight: fontSizes.sm * 1.45,
    },
    // Row-level delete — danger outlined, visually apart from the amber
    // retry/claim actions stacked above it.
    deleteBtn: {
      marginTop: spacing.md,
      alignSelf: 'flex-start',
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: `${colors.danger}66`,
      backgroundColor: colors.surfaceAlt,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    deleteBtnText: {
      color: colors.danger,
      fontSize: fontSizes.sm,
      fontWeight: fontWeights.semibold,
    },
    eventConfidence: {
      alignItems: 'flex-end',
    },
    eventConfidenceLabel: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xs,
      color: colors.textMuted,
      marginBottom: 2,
    },
    eventConfidenceValue: {
      fontSize: fontSizes['3xl'],
      fontWeight: fontWeights.bold,
      lineHeight: 22,
    },
    eventDetail: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.surface,
      padding: spacing.md + 2,
    },
    eventNotes: {
      fontSize: fontSizes.base,
      color: colors.textSecondary,
      lineHeight: 19,
      marginBottom: spacing.md,
    },
    gpsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.surfaceAlt,
      borderRadius: radii.sm,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      marginBottom: spacing.md,
    },
    gpsText: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xs,
      color: colors.sage,
    },
    detailRow: {
      flexDirection: 'row',
      gap: spacing.xl,
      marginBottom: spacing.md,
    },
    detailLabel: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xxs,
      color: colors.textDim,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      marginBottom: 3,
    },
    detailValue: {
      fontFamily: 'monospace',
      fontSize: fontSizes.sm,
      color: colors.textPrimary,
    },
    txSig: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xs,
      color: colors.sky,
      lineHeight: 15,
    },

    // FAB
    skeletonCard: {
      padding: spacing.md + 2,
      gap: spacing.sm,
    },
    // Docked action stack — floats above the scroll content, hugging the
    // right edge just above the tab bar. `fabStack` now holds the unfolded
    // actions above the circle, so its gap is the hinge of the fold.
    fabStack: {
      position: 'absolute',
      right: spacing.lg,
      bottom: spacing.lg,
      alignItems: 'flex-end',
      gap: spacing.sm,
    },
    // Wraps the two pills so they can be revealed as one group while each
    // still staggers on its own value.
    fabActions: {
      alignItems: 'flex-end',
      gap: spacing.sm,
    },
    // The circular control that folds and unfolds the stack. Same amber as
    // the primary pill, so it reads as that pill rolled up.
    fabCircle: {
      width: 56,
      height: 56,
      borderRadius: radii.full,
      backgroundColor: colors.amber,
      alignItems: 'center',
      justifyContent: 'center',
    },
    fab: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.amber,
      borderRadius: radii.full,
      paddingVertical: 13,
      paddingHorizontal: spacing.xl,
    },
    fabText: {
      color: colors.surface,
      fontSize: fontSizes.md,
      fontWeight: fontWeights.bold,
    },
    // Secondary pill under the scout action: solid surface so it reads over
    // scrolling content, amber hairline to stay in the brand family.
    fabSecondary: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.surfaceAlt,
      borderRadius: radii.full,
      borderWidth: 1,
      borderColor: `${colors.amber}66`,
      paddingVertical: 11,
      paddingHorizontal: spacing.xl,
    },
    fabSecondaryText: {
      color: colors.amber,
      fontSize: fontSizes.md,
      fontWeight: fontWeights.semibold,
    },
  })
