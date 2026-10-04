/**
 * app/(tabs)/index.tsx — Scouting Screen
 *
 * Summary tiles, per-field risk status, the scouting log with expandable
 * detail rows, and the docked action stack — "Scout Field" over "Register
 * farm" — fixed just above the tab bar.
 *
 * The log is chain-aware:
 *   - wallet connected + farm registered → reports read from the chain
 *     (`useReportsQuery`, newest first), rows carry their review status
 *   - wallet connected, no farm yet     → register-farm empty state
 *   - not connected                     → seeded sample log (marked as such)
 *
 * Locally submitted rows are merged optimistically and deduped by report
 * address, so the refetch after a submit cannot double-render a row.
 */

import { useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import Svg, { Circle, Path } from 'react-native-svg'
import * as Haptics from 'expo-haptics'
import { CameraOverlay } from '@/components/camera-overlay'
import { RegisterFarmModal } from '@/components/register-farm-modal'
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
import { SCOUT_EVENTS, type ScoutEvent, type Field } from '@/constants/data'
import { useMobileWalletSetup } from '@/features/wallet/useMobileWalletSetup'
import { useFarmQuery } from '@/features/farm/useFarmQuery'
import { useReportsQuery } from '@/features/reports/useReportsQuery'
import { mergeLogEvents, reportToScoutEvent } from '@/features/reports/chain-events'
import { buildFieldsFromEvents, buildFieldsFromReports } from '@/features/scout/fields'
import { useT, type MessageKey } from '@/lib/i18n'

const STATUS_KEYS = {
  pending: 'scout.status.pending',
  verified: 'scout.status.verified',
  rejected: 'scout.status.rejected',
  rewarded: 'scout.status.rewarded',
} as const satisfies Record<string, MessageKey>

export default function ScoutingScreen() {
  const [localEvents, setLocalEvents] = useState<ScoutEvent[]>([])
  const [expanded, setExpanded] = useState<string | null>('sc001')
  const [cameraOpen, setCameraOpen] = useState(false)
  const [registerOpen, setRegisterOpen] = useState(false)
  const { address } = useMobileWalletSetup()
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const t = useT()

  const farmQuery = useFarmQuery()
  const farm = farmQuery.farm
  const reportsQuery = useReportsQuery(
    farm && farmQuery.farmAddress ? { address: farmQuery.farmAddress, reportCount: farm.reportCount } : null,
  )

  const connected = !!address
  const onChain = connected && farmQuery.state === 'ready' && !!farm
  const registerPrompt = connected && farmQuery.state === 'ready' && !farm
  const readFailed = connected && farmQuery.state === 'error'
  const reportsFailed = onChain && reportsQuery.state === 'error'

  const baseEvents: ScoutEvent[] =
    onChain && farm ? reportsQuery.reports.map((report) => reportToScoutEvent(report, farm)) : SCOUT_EVENTS
  const events = mergeLogEvents(localEvents, baseEvents)

  // Field cards follow the same source as the log: chain when the farm is
  // registered, the seeded sample log otherwise.
  const fields: Field[] =
    onChain && farm ? buildFieldsFromReports(reportsQuery.reports, farm.name) : buildFieldsFromEvents(SCOUT_EVENTS)

  const alerts = fields.filter((f) => f.status !== 'clean').length
  const worstField = fields.filter((f) => f.status !== 'clean').sort((a, b) => b.risk - a.risk)[0]

  function openCamera() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setCameraOpen(true)
  }

  function toggleEvent(id: string) {
    Haptics.selectionAsync()
    setExpanded((current) => (current === id ? null : id))
  }

  function handleNewEvent(event: ScoutEvent) {
    setLocalEvents((prev) => mergeLogEvents([event], prev))
    setExpanded(event.id)
  }

  const showSkeleton = connected && (farmQuery.state === 'loading' || (onChain && reportsQuery.state === 'loading'))

  if (showSkeleton) return <ScoutingSkeleton />
  if (readFailed) return <ScoutingError onRetry={farmQuery.retry} />

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
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

        {/* ── Attention banner ──────────────────────────────────── */}
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
        ) : (
          <Banner
            tone="success"
            title={t('scout.banner.clear')}
            message={t('scout.banner.clearBody')}
            style={styles.bannerAfterTiles}
          />
        )}

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
        <View style={styles.block}>
          <SectionLabel>{t('scout.log', { n: events.length })}</SectionLabel>

          {!connected ? <Text style={styles.sampleHint}>{t('scout.sampleHint')}</Text> : null}

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
              {events.length === 0 ? (
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
                              <Text style={styles.detailValue}>{ev.images} anchored</Text>
                            </View>
                            {ev.chainStatus ? null : (
                              <View>
                                <Text style={styles.detailLabel}>{t('scout.model')}</Text>
                                <Text style={[styles.detailValue, { color: colors.sageLight }]}>PlantNet-v4.2</Text>
                              </View>
                            )}
                          </View>

                          <Text style={styles.detailLabel}>{ev.chainStatus ? t('scout.pda') : t('scout.tx')}</Text>
                          <Text style={styles.txSig}>{ev.txSig}</Text>
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
      {/* Fixed just above the tab bar: Scout Field on top, Register farm
          beneath it. The modal's only other entry point is the connected-
          unregistered empty state, so this is what makes it reachable for
          everyone. `box-none` keeps the gap between pills scrollable. */}
      <View style={styles.fabStack} pointerEvents="box-none" testID="scout-actions">
        <Pressable style={styles.fab} onPress={openCamera} accessibilityRole="button" accessibilityLabel="Scout field">
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

        <Pressable
          style={styles.fabSecondary}
          onPress={() => {
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
      // Clears the docked action stack (two pills + gap + offset ≈ 110).
      paddingBottom: 128,
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
    sampleHint: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xs,
      color: colors.textDim,
      marginTop: 4,
      marginBottom: spacing.sm,
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
    // right edge just above the tab bar.
    fabStack: {
      position: 'absolute',
      right: spacing.lg,
      bottom: spacing.lg,
      alignItems: 'flex-end',
      gap: spacing.sm,
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
