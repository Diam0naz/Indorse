/**
 * app/(tabs)/farms.tsx — Provenance Screen
 *
 * Data sources (real chain reads):
 *   useFarmQuery       → farm PDA + account
 *   useReportsQuery    → provenance score (verified / total)
 *   useEscrowQuery     → active escrow for the farm's latest batch
 *   useHarvestQuery    → the escrowed batch's crop + quantity for display
 */

import { useRef, useState, useEffect } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import * as Haptics from 'expo-haptics'
import Clipboard from '@react-native-clipboard/clipboard'
import { Banner, Card, Chip, EmptyState, ErrorState, SectionLabel, Skeleton } from '@/components/screen-kit'
import { ConfirmModal } from '@/components/confirm-modal'
import { LogHarvestModal } from '@/components/log-harvest-modal'
import { SetupEscrowModal } from '@/components/setup-escrow-modal'
import { useFarmRegistry } from '@/components/farm-registry-provider'
import { useTheme } from '@/components/theme-provider'
import { createStyles, fontSizes, fontWeights, radii, spacing, type Colors } from '@/constants/theme'
import { useFarmQuery } from '@/features/farm/useFarmQuery'
import { useDeleteFarm } from '@/features/farm/useDeleteFarm'
import { useReportsQuery } from '@/features/reports/useReportsQuery'
import { useCancelEscrow, useReleaseEscrow } from '@/features/escrow/useEscrow'
import { useEscrowQuery } from '@/features/escrow/useEscrowQuery'
import { useHarvestQuery } from '@/features/harvest/useHarvestQuery'
import { useMobileWalletSetup } from '@/features/wallet/useMobileWalletSetup'
import { formatUsdc, shortenAddress } from '@/lib/format'
import { useT, type MessageKey } from '@/lib/i18n'

export default function ProvenanceScreen() {
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const t = useT()
  const [copied, setCopied] = useState<string | null>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [escrowOpen, setEscrowOpen] = useState(false)
  const [harvestOpen, setHarvestOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  // The lock window is judged once per mount — a re-render must not shift it.
  const [nowSeconds] = useState(() => Math.floor(Date.now() / 1000))
  const { address: connectedAddress } = useMobileWalletSetup()
  const release = useReleaseEscrow()
  const cancel = useCancelEscrow()
  const deleteFarm = useDeleteFarm()
  const { removeFarm } = useFarmRegistry()

  const farmQuery = useFarmQuery()
  const farm = farmQuery.farm
  const farmAddress = farmQuery.farmAddress

  const reportsQuery = useReportsQuery(
    farm && farmAddress ? { address: farmAddress, reportCount: farm.reportCount } : null,
  )

  const escrowQuery = useEscrowQuery(farm && farmAddress ? { farmAddress, batchCount: farm.batchCount } : null)

  const harvestQuery = useHarvestQuery(farm && farmAddress ? { farmAddress, batchCount: farm.batchCount } : null)

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current)
    }
  }, [])

  function copy(key: string, value: string) {
    Haptics.selectionAsync()
    Clipboard.setString(value)
    setCopied(key)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(null), 1600)
  }

  const loading =
    farmQuery.state === 'loading' ||
    (farm !== null && reportsQuery.state === 'loading') ||
    (farm !== null && escrowQuery.state === 'loading') ||
    (farm !== null && harvestQuery.state === 'loading')

  if (loading) return <ProvenanceSkeleton />

  if (farmQuery.state === 'error') {
    return (
      <View style={styles.screen}>
        <View style={styles.centerShell}>
          <ErrorState
            title={t('scout.chain.error')}
            message={t('scout.chain.errorBody')}
            retryLabel={t('scout.chain.retry')}
            onRetry={farmQuery.retry}
          />
        </View>
      </View>
    )
  }

  // ── Derived data ───────────────────────────────────────────────────────
  const reports = reportsQuery.reports
  const verifiedCount = reports.filter((r) => r.status === 'verified' || r.status === 'rewarded').length
  const score = reports.length > 0 ? Math.round((verifiedCount / reports.length) * 100) : 0
  const scoreColor = score >= 80 ? colors.sageLight : score >= 60 ? colors.warningText : colors.dangerText

  const escrow = escrowQuery.escrow
  const escrowAddress = escrowQuery.escrowAddress
  // The batch the escrow is attached to — decoded crop/quantity when the
  // harvest read has landed, the raw (shortened) address until then.
  const escrowBatch = harvestQuery.batches.find((b) => b.address === escrowQuery.batchAddress) ?? null

  // Newest batch first (useHarvestQuery sorts descending) — the batch an
  // escrow attaches to. No farm → no setup actions at all.
  const latestBatch = harvestQuery.batches[0] ?? null
  const batchCount = farm?.batchCount ?? 0
  const canEscrow = !!farm && !!latestBatch?.address
  const canLogBatch = !!farm && batchCount === 0
  const isFarmer = !!connectedAddress && connectedAddress === escrow?.farmer
  const isBuyer = !!connectedAddress && connectedAddress === escrow?.buyer
  const lockExpired = escrow ? nowSeconds >= escrow.lockUntil : false

  function handleRelease() {
    if (!escrowQuery.batchAddress) return
    release.mutate(escrowQuery.batchAddress)
  }

  function handleCancel() {
    if (!escrowQuery.batchAddress) return
    cancel.mutate(escrowQuery.batchAddress)
  }

  const addresses: { key: MessageKey; value: string }[] = farmAddress
    ? [
        { key: 'prov.addrPda', value: farmAddress },
        { key: 'prov.addrEscrow', value: escrowAddress ?? '—' },
        { key: 'prov.addrBuyer', value: escrow?.buyer ?? '—' },
      ]
    : []

  const hasEscrow = !!escrow
  const hasAddresses = addresses.length > 0

  const scoreBanner =
    score >= 80 ? (
      <Banner
        tone="success"
        title={t('prov.banner.complete')}
        message={t('prov.banner.completeBody')}
        style={styles.bannerFlush}
      />
    ) : score >= 60 ? (
      <Banner
        tone="warning"
        title={t('prov.banner.incomplete')}
        message={t('prov.banner.incompleteBody', { score })}
        style={styles.bannerFlush}
      />
    ) : (
      <Banner
        tone="danger"
        title={t('prov.banner.risk')}
        message={t('prov.banner.riskBody')}
        style={styles.bannerFlush}
      />
    )

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* ── Provenance score ──────────────────────────────────── */}
        <Card>
          <SectionLabel>{t('prov.score')}</SectionLabel>
          <View style={styles.scoreRow}>
            <Text style={[styles.scoreValue, { color: scoreColor }]}>{score}</Text>
            <Text style={styles.scoreMax}>/100</Text>
          </View>
          <View style={styles.scoreTrack}>
            <View style={[styles.scoreFill, { width: `${score}%`, backgroundColor: scoreColor }]} />
          </View>
          <Text style={styles.scoreCaption}>{t('prov.scoreCaption', { n: reports.length })}</Text>
        </Card>

        {scoreBanner}

        {/* ── Escrow ────────────────────────────────────────────── */}
        {hasEscrow && escrow ? (
          <Card style={styles.gap}>
            <View style={styles.escrowTop}>
              <View style={styles.escrowMain}>
                <SectionLabel>{t('prov.escrow')}</SectionLabel>
                <Text style={styles.escrowCommodity}>
                  {escrowBatch
                    ? `${escrowBatch.crop} · ${escrowBatch.quantityKg.toLocaleString()} kg`
                    : escrowQuery.batchAddress
                      ? shortenAddress(escrowQuery.batchAddress, 8)
                      : '—'}
                </Text>
                <Text style={styles.escrowBuyer}>{shortenAddress(escrow.buyer, 8)}</Text>
              </View>
              <View style={styles.escrowValue}>
                <Text style={styles.escrowValueLabel}>{t('prov.locked')}</Text>
                <Text style={styles.escrowValueAmount}>{formatUsdc(escrow.amountUsdc)}</Text>
                <Text style={styles.escrowValueQty}>{escrow.state}</Text>
              </View>
            </View>

            {escrow.state === 'funded' && (
              <>
                <View style={styles.fundTrack}>
                  <View style={styles.fundFill} />
                </View>
                <View style={styles.fundMeta}>
                  <Text style={styles.fundMetaText}>{t('prov.funded')}</Text>
                  <Text style={styles.fundStatus}>{t('prov.pending')}</Text>
                </View>
              </>
            )}

            <SectionLabel>{t('prov.release')}</SectionLabel>
            {escrow.state === 'funded' && (isFarmer || (isBuyer && !lockExpired)) ? (
              <View style={styles.actionRow}>
                {isFarmer ? (
                  <Pressable
                    style={[styles.releaseBtn, (release.isPending || cancel.isPending) && styles.actionBusy]}
                    onPress={handleRelease}
                    disabled={release.isPending || cancel.isPending}
                    accessibilityRole="button"
                    accessibilityLabel={t('prov.releaseFunds')}
                  >
                    <Text style={styles.actionBtnText}>{t('prov.releaseFunds')}</Text>
                  </Pressable>
                ) : null}
                {isBuyer && !lockExpired ? (
                  <Pressable
                    style={[styles.cancelBtn, (release.isPending || cancel.isPending) && styles.actionBusy]}
                    onPress={handleCancel}
                    disabled={release.isPending || cancel.isPending}
                    accessibilityRole="button"
                    accessibilityLabel={t('prov.cancelEscrow')}
                  >
                    <Text style={styles.actionBtnText}>{t('prov.cancelEscrow')}</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : (
              <Text style={styles.noConditions}>{t('prov.noConditions')}</Text>
            )}
            {release.isError && release.error ? (
              <Text style={styles.actionError}>{release.error.message}</Text>
            ) : cancel.isError && cancel.error ? (
              <Text style={styles.actionError}>{cancel.error.message}</Text>
            ) : null}
          </Card>
        ) : (
          <Card style={styles.gap}>
            <EmptyState
              title={t('prov.empty.escrow')}
              message={canLogBatch ? t('prov.empty.noBatch') : t('prov.empty.escrowBody')}
              actionLabel={canEscrow ? t('prov.escrow.cta') : canLogBatch ? t('prov.harvest.cta') : undefined}
              onAction={canEscrow ? () => setEscrowOpen(true) : canLogBatch ? () => setHarvestOpen(true) : undefined}
            />
          </Card>
        )}

        {/* ── Addresses ─────────────────────────────────────────── */}
        <Card style={styles.gap}>
          <SectionLabel>{t('prov.addresses')}</SectionLabel>
          {!hasAddresses ? (
            <EmptyState title={t('prov.empty.addresses')} message={t('prov.empty.addressesBody')} />
          ) : (
            <>
              {addresses.map((row) => (
                <Pressable key={row.key} style={styles.addressRow} onPress={() => copy(row.key, row.value)}>
                  <View style={styles.addressText}>
                    <Text style={styles.addressLabel}>{t(row.key)}</Text>
                    <Text style={styles.addressValue} numberOfLines={1}>
                      {row.value}
                    </Text>
                  </View>
                  <Chip
                    label={copied === row.key ? t('prov.copied') : t('prov.copy')}
                    color={copied === row.key ? colors.sage : colors.sky}
                  />
                </Pressable>
              ))}
              <Chip
                label={`Score ${score} · ${escrow?.state ?? 'no escrow'}`}
                color={colors.amber}
                style={styles.statusChip}
              />
            </>
          )}
        </Card>

        {/* ── Danger zone: close the on-chain farm record ─────────── */}
        {farmAddress ? (
          <Card style={styles.gap}>
            <SectionLabel>{t('prov.dangerZone')}</SectionLabel>
            <Text style={styles.dangerLead}>{t('prov.deleteFarm.lead')}</Text>
            <Pressable
              style={styles.dangerBtn}
              onPress={() => setDeleteOpen(true)}
              testID="delete-farm-open"
              accessibilityRole="button"
              accessibilityLabel={t('prov.deleteFarm.cta')}
            >
              <Text style={styles.dangerBtnText}>{t('prov.deleteFarm.cta')}</Text>
            </Pressable>
          </Card>
        ) : null}

        {/* ── Setup flows: harvest batch → escrow ─────────────────── */}
        {harvestOpen && farmAddress && farm ? (
          <LogHarvestModal
            farmAddress={farmAddress}
            batchCount={batchCount}
            scoutReports={farm.reportCount}
            verifiedReports={farm.verifiedReportCount}
            onClose={() => setHarvestOpen(false)}
          />
        ) : null}
        {escrowOpen && canEscrow && latestBatch?.address ? (
          <SetupEscrowModal
            batchAddress={latestBatch.address}
            batchLabel={`${latestBatch.crop} · ${latestBatch.quantityKg.toLocaleString()} kg`}
            onClose={() => setEscrowOpen(false)}
          />
        ) : null}
        {deleteOpen && farmAddress ? (
          <ConfirmModal
            title={t('prov.deleteFarm.title')}
            lead={t('prov.deleteFarm.lead')}
            bullets={[t('prov.deleteFarm.bulletEvidence'), t('prov.deleteFarm.bulletOwner')]}
            confirmLabel={t('prov.deleteFarm.submit')}
            busyLabel={t('prov.deleteFarm.submitting')}
            walletNeeded={t('prov.deleteFarm.walletNeeded')}
            testID="delete-farm-confirm"
            danger
            onConfirm={async () => {
              await deleteFarm.mutateAsync(farmAddress)
              // The record is gone on chain — drop the local entry with it.
              removeFarm(farmAddress)
            }}
            onClose={() => setDeleteOpen(false)}
          />
        ) : null}
      </ScrollView>
    </View>
  )
}

/* ── Loading skeleton ───────────────────────────────────────────────────────── */

function ProvenanceSkeleton() {
  const styles = makeStyles(useTheme().colors)
  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Card>
          <Skeleton height={9} width={130} />
          <Skeleton height={46} width={90} style={{ marginTop: spacing.md }} />
          <Skeleton height={6} style={{ marginTop: spacing.md }} />
          <Skeleton height={9} style={{ marginTop: spacing.sm }} />
          <Skeleton height={9} width="70%" style={{ marginTop: 4 }} />
        </Card>

        <Card>
          <Skeleton height={9} width={60} />
          <Skeleton height={18} width="62%" style={{ marginTop: spacing.sm }} />
          <Skeleton height={11} width="42%" style={{ marginTop: 6 }} />
          <Skeleton height={5} style={{ marginTop: spacing.md }} />
          <Skeleton height={9} width={110} style={{ marginTop: spacing.lg }} />
          <Skeleton height={30} style={{ marginTop: spacing.sm }} />
          <Skeleton height={30} />
          <Skeleton height={30} />
        </Card>

        <Card>
          <Skeleton height={9} width={140} />
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={34} style={{ marginTop: spacing.sm }} />
          ))}
        </Card>
      </ScrollView>
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
      paddingBottom: spacing['3xl'],
      gap: spacing.md,
    },
    centerShell: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: spacing.lg,
    },
    gap: {
      marginTop: 0,
    },
    bannerFlush: {
      marginBottom: 0,
    },
    noConditions: {
      fontSize: fontSizes.base,
      color: colors.textMuted,
      lineHeight: 18,
    },
    actionRow: {
      flexDirection: 'row',
      gap: spacing.md,
    },
    releaseBtn: {
      flex: 1,
      backgroundColor: colors.primary,
      borderRadius: radii.md,
      paddingVertical: spacing.md,
      alignItems: 'center',
    },
    cancelBtn: {
      flex: 1,
      backgroundColor: colors.danger,
      borderRadius: radii.md,
      paddingVertical: spacing.md,
      alignItems: 'center',
    },
    actionBtnText: {
      color: colors.surface,
      fontSize: fontSizes.sm,
      fontWeight: fontWeights.bold,
    },
    actionBusy: {
      opacity: 0.6,
    },
    actionError: {
      fontSize: fontSizes.xs,
      color: colors.dangerText,
      lineHeight: 16,
    },

    // Score
    scoreRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: spacing.sm,
      marginBottom: spacing.md,
    },
    scoreValue: {
      fontSize: fontSizes['6xl'],
      fontWeight: fontWeights.bold,
      lineHeight: 60,
    },
    scoreMax: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xl,
      color: colors.textDim,
      paddingBottom: 6,
    },
    scoreTrack: {
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.border,
      overflow: 'hidden',
      marginBottom: spacing.md,
    },
    scoreFill: {
      height: '100%',
      borderRadius: 3,
    },
    scoreCaption: {
      fontSize: fontSizes.base,
      color: colors.textMuted,
      lineHeight: 18,
    },

    // Escrow
    escrowTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: spacing.md,
      gap: spacing.md,
    },
    escrowMain: {
      flex: 1,
    },
    escrowCommodity: {
      fontSize: fontSizes.xl,
      fontWeight: fontWeights.bold,
      color: colors.textPrimary,
    },
    escrowBuyer: {
      fontSize: fontSizes.base,
      color: colors.textMuted,
      marginTop: 2,
    },
    escrowValue: {
      alignItems: 'flex-end',
    },
    escrowValueLabel: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xxs,
      color: colors.textDim,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      marginBottom: 4,
    },
    escrowValueAmount: {
      fontSize: fontSizes['3xl'],
      fontWeight: fontWeights.bold,
      color: colors.amber,
      lineHeight: 24,
    },
    escrowValueQty: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xs,
      color: colors.textMuted,
      marginTop: 3,
    },
    fundTrack: {
      height: 5,
      borderRadius: 3,
      backgroundColor: colors.border,
      overflow: 'hidden',
      marginBottom: 6,
    },
    fundFill: {
      height: '100%',
      width: '100%',
      borderRadius: 3,
      backgroundColor: colors.amberLight,
    },
    fundMeta: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: spacing.lg,
    },
    fundMetaText: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xs,
      color: colors.textMuted,
    },
    fundStatus: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xs,
      color: colors.warningText,
      letterSpacing: 0.8,
    },

    // Addresses
    addressRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.sm + 2,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    addressText: {
      flex: 1,
      minWidth: 0,
    },
    addressLabel: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xxs,
      color: colors.textDim,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      marginBottom: 3,
    },
    addressValue: {
      fontFamily: 'monospace',
      fontSize: fontSizes.sm,
      color: colors.sky,
    },
    statusChip: {
      marginTop: spacing.md,
    },

    // Danger zone — closing the on-chain farm record
    dangerLead: {
      fontSize: fontSizes.sm,
      color: colors.textMuted,
      lineHeight: 18,
      marginBottom: spacing.md,
    },
    dangerBtn: {
      borderWidth: 1,
      borderColor: colors.danger,
      borderRadius: radii.md,
      paddingVertical: spacing.md,
      alignItems: 'center',
    },
    dangerBtnText: {
      color: colors.dangerText,
      fontSize: fontSizes.sm,
      fontWeight: fontWeights.semibold,
    },
  })
