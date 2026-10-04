/**
 * app/(tabs)/reports.tsx — Weather Screen
 *
 * Parametric weather policy: cover details, the live oracle rainfall reading
 * against the trigger threshold, and a season chart.
 *
 * Data sources (real chain reads):
 *   useFarmQuery            → farmAddress + farm.policyCount
 *   usePolicyQuery          → policy details (trigger, season dates, coverage)
 *   useWeatherOracleQuery   → latest oracle rainfall reading
 *
 * The WeatherOracle stores a single season-total figure, not monthly buckets.
 * Two horizontal bars (rainfall vs trigger) replace the multi-month SVG chart
 * when real data is present. The season chart card stays as an empty state
 * when no oracle account exists yet.
 */

import { useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg'
import { Banner, Card, Chip, EmptyState, ErrorState, SectionLabel, Skeleton } from '@/components/screen-kit'
import { ConfirmModal } from '@/components/confirm-modal'
import { UnderwritePolicyModal } from '@/components/underwrite-policy-modal'
import { useTheme } from '@/components/theme-provider'
import { createStyles, fontSizes, fontWeights, radii, spacing, type Colors } from '@/constants/theme'
import { useFarmQuery } from '@/features/farm/useFarmQuery'
import { usePolicyQuery } from '@/features/insurance/usePolicyQuery'
import { useRevokePolicy } from '@/features/insurance/useRevokePolicy'
import { useWeatherOracleQuery } from '@/features/insurance/useWeatherOracleQuery'
import { formatTimestamp, shortenAddress } from '@/lib/format'
import { useT } from '@/lib/i18n'

/** Scale for the horizontal reading bars: 0–300 mm. */
const MAX_READING_MM = 300

export default function WeatherScreen() {
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const t = useT()
  const [policyOpen, setPolicyOpen] = useState(false)
  const [revokeOpen, setRevokeOpen] = useState(false)
  const revokePolicy = useRevokePolicy()

  const farmQuery = useFarmQuery()
  const farm = farmQuery.farm
  const farmAddress = farmQuery.farmAddress

  const policyQuery = usePolicyQuery(farm && farmAddress ? { farmAddress, policyCount: farm.policyCount } : null)
  const policy = policyQuery.policy

  const oracleQuery = useWeatherOracleQuery(
    policy && farmAddress ? { farmAddress, seasonStart: policy.seasonStart } : null,
  )
  const reading = oracleQuery.reading

  // ── Loading ────────────────────────────────────────────────────────────
  const loading = farmQuery.state === 'loading' || (farm !== null && policyQuery.state === 'loading')

  if (loading) return <WeatherSkeleton />

  // ── Oracle error (policy loaded, oracle fetch failed) ──────────────────
  if (oracleQuery.state === 'error') {
    return <WeatherError onRetry={oracleQuery.retry} />
  }

  // ── Farm chain error ───────────────────────────────────────────────────
  if (farmQuery.state === 'error' || policyQuery.state === 'error') {
    return <WeatherError onRetry={farmQuery.state === 'error' ? farmQuery.retry : policyQuery.retry} />
  }

  // ── Derived values ─────────────────────────────────────────────────────
  const hasPolicy = !!policy
  // Countdown reads the wall clock at render time — deliberate for a live
  // expiry display, so the purity rule is waived rather than re-rendered.
  // eslint-disable-next-line react-hooks/purity
  const nowSeconds = Date.now() / 1000
  const daysLeft: number = policy ? Math.max(0, Math.ceil((policy.seasonEnd - nowSeconds) / 86400)) : 0
  const isExpired = hasPolicy && nowSeconds > (policy?.seasonEnd ?? 0)
  const isExpiring = hasPolicy && !isExpired && daysLeft <= 2

  const triggerMm = policy ? policy.triggerThresholdMm / 10 : 0
  const rainfallMm = reading ? reading.totalRainfallMm / 10 : 0
  const lastUpdate = reading ? formatTimestamp(reading.readingTimestamp) : '—'
  const policyLabel = policyQuery.policyAddress ? shortenAddress(policyQuery.policyAddress, 8) : '—'

  const expiryBanner = isExpired ? (
    <Banner tone="info" title={t('wx.banner.ended')} message={t('wx.banner.endedBody')} style={styles.bannerFlush} />
  ) : isExpiring ? (
    <Banner
      tone="warning"
      title={daysLeft === 1 ? t('wx.banner.expiringOne') : t('wx.banner.expiring', { days: daysLeft })}
      message={t('wx.banner.expiringBody')}
      style={styles.bannerFlush}
    />
  ) : null

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {expiryBanner}

        {/* ── Policy ────────────────────────────────────────────── */}
        {hasPolicy && policy ? (
          <Card>
            <View style={styles.policyTop}>
              <View style={styles.policyMain}>
                <SectionLabel>{t('wx.policy')}</SectionLabel>
                <Text style={styles.policyId}>{policyLabel}</Text>
              </View>
              <Chip
                label={isExpired ? t('wx.expired') : t('wx.active')}
                color={isExpired ? colors.warningText : colors.sageLight}
                filled
              />
            </View>

            <View style={styles.policyStats}>
              {[
                {
                  label: t('wx.maxPayout'),
                  value: `$${(policy.coverageUsdc / 1_000_000).toFixed(0)}`,
                  color: colors.sky,
                },
                {
                  label: t('wx.premium'),
                  value: `$${(policy.premiumUsdc / 1_000_000).toFixed(0)}`,
                  color: colors.textPrimary,
                },
              ].map((s) => (
                <View key={s.label} style={styles.policyStat}>
                  <Text style={styles.policyStatLabel}>{s.label}</Text>
                  <Text style={[styles.policyStatValue, { color: s.color }]}>{s.value}</Text>
                </View>
              ))}
            </View>

            <View style={styles.triggerBox}>
              <Text style={styles.policyStatLabel}>{t('wx.trigger')}</Text>
              <Text style={styles.triggerText}>
                {`Payout triggers if season rainfall falls below ${triggerMm} mm.`}
              </Text>
            </View>

            {policy.state === 'active' && !isExpired && farmAddress ? (
              <>
                <Pressable
                  style={styles.revokeBtn}
                  onPress={() => setRevokeOpen(true)}
                  testID="revoke-policy-open"
                  accessibilityRole="button"
                  accessibilityLabel={t('wx.revoke.cta')}
                >
                  <Text style={styles.revokeText}>{t('wx.revoke.cta')}</Text>
                </Pressable>
                <Text style={styles.revokeHelp}>{t('wx.revoke.help')}</Text>
              </>
            ) : null}
          </Card>
        ) : (
          <Card>
            <EmptyState
              title={t('wx.empty.policy')}
              message={t('wx.empty.policyBody')}
              actionLabel={farmAddress ? t('wx.empty.policyCta') : undefined}
              onAction={farmAddress ? () => setPolicyOpen(true) : undefined}
            />
          </Card>
        )}

        {/* ── Oracle readings ───────────────────────────────────── */}
        <Card>
          <SectionLabel>{t('wx.oracle')}</SectionLabel>

          <View style={styles.reading}>
            <View style={styles.readingHeader}>
              <Text style={styles.readingLabel}>{t('wx.rainfall')}</Text>
              <Text style={[styles.readingValue, { color: colors.sage }]}>{t('wx.mm', { mm: rainfallMm })}</Text>
            </View>
            <View style={styles.readingTrack}>
              <View
                style={[
                  styles.readingFill,
                  {
                    width: `${Math.min(100, (rainfallMm / MAX_READING_MM) * 100)}%`,
                    backgroundColor: colors.sage,
                  },
                ]}
              />
            </View>
            <View style={styles.readingAxis}>
              <Text style={styles.axisText}>{t('wx.axisMin')}</Text>
              <Text style={styles.axisText}>{t('wx.axisMax')}</Text>
            </View>
          </View>

          <View style={styles.reading}>
            <View style={styles.readingHeader}>
              <Text style={styles.readingLabel}>{t('wx.triggerThreshold')}</Text>
              <Text style={[styles.readingValue, { color: colors.danger }]}>{t('wx.mm', { mm: triggerMm })}</Text>
            </View>
            <View style={styles.readingTrack}>
              <View
                style={[
                  styles.readingFill,
                  {
                    width: `${Math.min(100, (triggerMm / MAX_READING_MM) * 100)}%`,
                    backgroundColor: colors.danger,
                  },
                ]}
              />
            </View>
            <View style={styles.readingAxis}>
              <Text style={styles.axisText}>{t('wx.axisMin')}</Text>
              <Text style={styles.axisText}>{t('wx.axisMax')}</Text>
            </View>
          </View>

          <View style={styles.oracleFooter}>
            <View>
              <Text style={styles.policyStatLabel}>{t('wx.daysLeft')}</Text>
              <Text style={styles.daysLeft}>{daysLeft}</Text>
            </View>
            <View style={styles.lastUpdate}>
              <Text style={styles.policyStatLabel}>{t('wx.lastUpdate')}</Text>
              <Text style={styles.lastUpdateText}>{lastUpdate}</Text>
            </View>
          </View>
        </Card>

        {/* ── Season chart ──────────────────────────────────────── */}
        <SeasonChartCard rainfallMm={rainfallMm} triggerMm={triggerMm} hasReading={!!reading} />

        {/* Setup flows — underwriting a policy against this farm's index. */}
        {policyOpen && farmAddress && farm ? (
          <UnderwritePolicyModal
            farmAddress={farmAddress}
            policyCount={farm.policyCount}
            onClose={() => setPolicyOpen(false)}
          />
        ) : null}
        {revokeOpen && farmAddress && farm ? (
          <ConfirmModal
            title={t('wx.revoke.title')}
            lead={t('wx.revoke.lead')}
            bullets={[t('wx.revoke.bulletWindow'), t('wx.revoke.bulletTreasury')]}
            confirmLabel={t('wx.revoke.submit')}
            busyLabel={t('wx.revoke.submitting')}
            walletNeeded={t('wx.revoke.walletNeeded')}
            testID="revoke-policy-confirm"
            danger
            onConfirm={async () => {
              await revokePolicy.mutateAsync({ farmAddress, policyCount: farm.policyCount })
            }}
            onClose={() => setRevokeOpen(false)}
          />
        ) : null}
      </ScrollView>
    </View>
  )
}

/* ── Season chart ──────────────────────────────────────────────────────────── */

const CHART_W = 300
const CHART_H = 90

function SeasonChartCard({
  rainfallMm,
  triggerMm,
  hasReading,
}: {
  rainfallMm: number
  triggerMm: number
  hasReading: boolean
}) {
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const t = useT()

  if (!hasReading) {
    return (
      <Card>
        <SectionLabel>{t('wx.chart')}</SectionLabel>
        <EmptyState title={t('wx.empty.chart')} message={t('wx.empty.chartBody')} />
      </Card>
    )
  }

  const MAX_MM = Math.max(rainfallMm, triggerMm, 50) * 1.15
  const barW = 80
  const gap = (CHART_W - 2 * barW) / 3

  const mmY = (mm: number) => CHART_H - (mm / MAX_MM) * (CHART_H - 18)

  return (
    <Card>
      <SectionLabel>{t('wx.chart')}</SectionLabel>

      <View style={styles.legend}>
        {[
          { color: colors.sage, label: t('wx.rainfall') },
          { color: colors.danger, label: `${t('wx.triggerThreshold')} (${triggerMm} mm)` },
        ].map((l) => (
          <View key={l.label} style={styles.legendItem}>
            <View style={[styles.legendSwatch, { backgroundColor: l.color }]} />
            <Text style={styles.legendText}>{l.label}</Text>
          </View>
        ))}
      </View>

      <Svg viewBox={`0 0 ${CHART_W} ${CHART_H + 20}`} style={styles.chart}>
        {/* Rainfall bar */}
        <Rect
          x={gap}
          y={mmY(rainfallMm)}
          width={barW}
          height={CHART_H - mmY(rainfallMm)}
          rx={4}
          fill={`${rainfallMm < triggerMm ? colors.danger : colors.sage}33`}
          stroke={rainfallMm < triggerMm ? colors.danger : colors.sage}
          strokeWidth={1}
        />
        <SvgText
          x={gap + barW / 2}
          y={CHART_H + 14}
          textAnchor="middle"
          fill={colors.textDim}
          fontSize={9}
          fontFamily="monospace"
        >
          {t('wx.rainfall')}
        </SvgText>

        {/* Trigger bar */}
        <Rect
          x={gap * 2 + barW}
          y={mmY(triggerMm)}
          width={barW}
          height={CHART_H - mmY(triggerMm)}
          rx={4}
          fill={`${colors.danger}22`}
          stroke={colors.danger}
          strokeWidth={1}
          strokeDasharray="4 2"
        />
        <SvgText
          x={gap * 2 + barW + barW / 2}
          y={CHART_H + 14}
          textAnchor="middle"
          fill={colors.textDim}
          fontSize={9}
          fontFamily="monospace"
        >
          {t('wx.triggerThreshold')}
        </SvgText>

        {/* Trigger line */}
        <Line
          x1={0}
          y1={mmY(triggerMm)}
          x2={CHART_W}
          y2={mmY(triggerMm)}
          stroke={colors.danger}
          strokeWidth={0.6}
          strokeDasharray="4 3"
          opacity={0.5}
        />
        <SvgText x={4} y={mmY(triggerMm) - 4} fontSize={8} fontFamily="monospace" fill={colors.danger}>
          {t('wx.triggerLine', { mm: triggerMm })}
        </SvgText>
      </Svg>
    </Card>
  )
}

/* ── Error / Skeleton shells ───────────────────────────────────────────────── */

function WeatherError({ onRetry }: { onRetry: () => void }) {
  const styles = makeStyles(useTheme().colors)
  const t = useT()
  return (
    <View style={styles.screen}>
      <View style={styles.centerShell}>
        <ErrorState
          title={t('wx.error.title')}
          message={t('wx.error.body')}
          retryLabel={t('wx.retry')}
          onRetry={onRetry}
        />
      </View>
    </View>
  )
}

function WeatherSkeleton() {
  const styles = makeStyles(useTheme().colors)
  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Card>
          <Skeleton height={9} width={130} />
          <Skeleton height={13} width="65%" style={{ marginTop: spacing.sm }} />
          <View style={styles.policyStats}>
            <Skeleton height={62} style={{ flex: 1 }} />
            <Skeleton height={62} style={{ flex: 1 }} />
          </View>
          <Skeleton height={54} />
        </Card>

        <Card>
          <Skeleton height={9} width={150} />
          {[0, 1].map((i) => (
            <View key={i} style={styles.reading}>
              <Skeleton height={12} width="55%" />
              <Skeleton height={8} style={{ marginTop: spacing.sm }} />
            </View>
          ))}
          <Skeleton height={40} />
        </Card>

        <Card>
          <Skeleton height={9} width={110} />
          <Skeleton height={150} style={{ marginTop: spacing.md }} />
        </Card>
      </ScrollView>
    </View>
  )
}

/* ── Styles ────────────────────────────────────────────────────────────────── */

const makeStyles = (colors: Colors) =>
  createStyles({
    screen: { flex: 1, backgroundColor: colors.surface },
    content: { padding: spacing.lg, paddingBottom: spacing['3xl'], gap: spacing.md },
    centerShell: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.lg },
    bannerFlush: { marginBottom: 0 },

    policyTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: spacing.md,
      gap: spacing.sm,
    },
    policyMain: { flex: 1 },
    policyId: { fontFamily: 'monospace', fontSize: fontSizes.sm, color: colors.textPrimary },
    policyStats: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
    policyStat: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md + 2,
    },
    policyStatLabel: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xxs,
      color: colors.textDim,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      marginBottom: 4,
    },
    policyStatValue: { fontSize: fontSizes['3xl'], fontWeight: fontWeights.bold, lineHeight: 24 },
    triggerBox: {
      backgroundColor: colors.surface,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md + 2,
    },
    triggerText: { fontSize: fontSizes.base, color: colors.textPrimary, lineHeight: 18 },

    reading: { marginBottom: spacing.lg },
    readingHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 6,
    },
    readingLabel: { fontSize: fontSizes.md, color: colors.textPrimary },
    readingValue: { fontFamily: 'monospace', fontSize: fontSizes.md },
    readingTrack: {
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.border,
      overflow: 'hidden',
      marginBottom: 4,
    },
    readingFill: { height: '100%', borderRadius: 4 },
    readingAxis: { flexDirection: 'row', justifyContent: 'space-between' },
    axisText: { fontFamily: 'monospace', fontSize: fontSizes.xxs, color: colors.textDim },
    oracleFooter: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      paddingTop: spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    daysLeft: { fontSize: fontSizes['2xl'], fontWeight: fontWeights.bold, color: colors.warningText },
    lastUpdate: { alignItems: 'flex-end' },
    lastUpdateText: { fontFamily: 'monospace', fontSize: fontSizes.sm, color: colors.textMuted },

    legend: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md, flexWrap: 'wrap' },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    legendSwatch: { width: 10, height: 3, borderRadius: 2 },
    legendText: { fontFamily: 'monospace', fontSize: fontSizes.xxs, color: colors.textMuted },
    chart: { width: '100%', height: 150 },

    // Revoking the active policy (danger action under the policy card)
    revokeBtn: {
      marginTop: spacing.md,
      borderWidth: 1,
      borderColor: colors.danger,
      borderRadius: radii.md,
      paddingVertical: spacing.md,
      alignItems: 'center',
    },
    revokeText: {
      color: colors.dangerText,
      fontSize: fontSizes.sm,
      fontWeight: fontWeights.semibold,
    },
    revokeHelp: {
      fontSize: fontSizes.xs,
      color: colors.textMuted,
      lineHeight: 16,
      marginTop: spacing.sm,
    },
  })
