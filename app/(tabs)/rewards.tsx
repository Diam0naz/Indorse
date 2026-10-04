/**
 * app/(tabs)/rewards.tsx — Profile Screen
 *
 * Operator identity, wallet balances, farm details, recent on-chain
 * activity and the settings list.
 *
 * Data sources (real chain reads):
 *   useMobileWalletSetup  → address, walletState
 *   useWalletBalances     → SOL + USDC from RPC
 *   useFarmQuery          → farm name, acres, report count
 *   useReportsQuery       → recent activity rows
 *   useEscrowQuery        → escrow locked amount
 *   useSkrName            → .skr domain for display name
 *   useProfile            → setup-wizard profile (name / bio / photo)
 *   useSetupSignals       → "Complete your setup" banner progress
 */

import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import * as Haptics from 'expo-haptics'
import { router, type Href } from 'expo-router'
import { useMobileWalletSetup } from '@/features/wallet'
import { useWalletBalances } from '@/features/wallet/useWalletBalances'
import { useFarmQuery } from '@/features/farm/useFarmQuery'
import { useReportsQuery } from '@/features/reports/useReportsQuery'
import { useEscrowQuery } from '@/features/escrow/useEscrowQuery'
import { setupProgress } from '@/features/profile/types'
import { useSetupSignals } from '@/features/profile/useSetupSignals'
import { Card, Divider, EmptyState, SectionLabel, Skeleton } from '@/components/screen-kit'
import { useProfile } from '@/components/profile-provider'
import { PersonIcon } from '@/components/person-icon'
import { useSettings } from '@/components/settings-provider'
import { useTheme } from '@/components/theme-provider'
import { createStyles, fontSizes, fontWeights, radii, spacing, type Colors } from '@/constants/theme'
import { CLUSTER_LABEL_KEYS } from '@/constants/app-config'
import { walletName } from '@/lib/wallet-name'
import { initialsOf } from '@/lib/display-name'
import { useSkrName } from '@/lib/skr'
import { shortenAddress, formatUsdc, formatShortDate, fromE6 } from '@/lib/format'
import { useT, type MessageKey } from '@/lib/i18n'
import { FontAwesome5 } from '@expo/vector-icons'
import type { ChainReport } from '@/features/reports/useReportsQuery'

const SETTINGS: { icon: string; key: MessageKey; route: Href }[] = [
  { icon: 'bell', key: 'settings.notifications', route: '/settings/notifications' },
  { icon: 'shield-alt', key: 'settings.security', route: '/settings/security' },
  { icon: 'user-alt', key: 'settings.account', route: '/settings/account' },
  { icon: 'globe', key: 'settings.network', route: '/settings/network' },
  { icon: 'clipboard-list', key: 'settings.export', route: '/settings/export' },
  { icon: 'globe-americas', key: 'settings.language', route: '/settings/language' },
  { icon: 'palette', key: 'settings.theme', route: '/settings/theme' },
]

/** Dot colour by report status / severity label. */
function activityColor(aiLabel: string, status: string): string {
  if (status === 'rejected') return '#9B968C'
  const lower = aiLabel.toLowerCase()
  if (lower.includes('no disease') || lower.includes('none')) return '#34B37E'
  if (lower.includes('high')) return '#E06B5A'
  if (lower.includes('medium')) return '#F2A340'
  return '#9B968C'
}

export default function ProfileScreen() {
  const { address, walletState, toggleConnection } = useMobileWalletSetup()
  const isConnected = walletState === 'connected'
  const isConnecting = walletState === 'connecting'

  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const t = useT()
  const { network, security } = useSettings()

  // ── Chain data ─────────────────────────────────────────────────────────
  const farmQuery = useFarmQuery()
  const farm = farmQuery.farm
  const farmAddress = farmQuery.farmAddress

  const reportsQuery = useReportsQuery(
    farm && farmAddress ? { address: farmAddress, reportCount: farm.reportCount } : null,
  )
  const escrowQuery = useEscrowQuery(farm && farmAddress ? { farmAddress, batchCount: farm.batchCount } : null)
  const { balances, loading: balancesLoading } = useWalletBalances(address)
  const skrName = useSkrName(address)

  // Setup wizard: saved profile (identity) + live banner progress.
  const { profile } = useProfile()
  const setupProgressState = setupProgress(useSetupSignals())

  // Loading: show skeleton if balances are still fetching and wallet is connected
  const loading = isConnected && balancesLoading && !farm

  // ── Display values ─────────────────────────────────────────────────────
  const masked = security.hideBalances
  const solDisplay = masked ? '•••' : balances.sol.toFixed(3)
  const usdcDisplay = masked ? '•••' : `$${balances.usdc.toLocaleString()}`

  const escrowLocked = escrowQuery.escrow?.amountUsdc ?? 0
  const escrowDisplay = masked ? '•••' : formatUsdc(escrowLocked)

  // Identity — the wizard's display name wins, then .skr, then the wallet label.
  const hasIdentity = Boolean(profile?.name || address)
  const displayName = (profile?.name || skrName) ?? walletName(address)
  // Initials only when there is a real identity; guests get the person icon.
  const initials = hasIdentity ? initialsOf(displayName) : ''
  const handle = address ? shortenAddress(address, 8) : t('profile.notConnected')
  const pubkey = address ? shortenAddress(address, 20) : null

  // NFT certs ≈ policy count
  const nftCerts = farm?.policyCount ?? 0

  // Farm details rows
  const farmName = farm?.name ?? '—'
  const farmLocation = farm ? `${fromE6(farm.latE6).toFixed(4)}° N, ${Math.abs(fromE6(farm.lngE6)).toFixed(4)}° W` : '—'
  const farmSeason = '—' // not stored on-chain
  const farmAcres = '—' // not stored on-chain
  const memberSince = '—' // not stored on-chain

  // Activity: latest 5 reports + escrow event
  const activityRows: { label: string; detail: string; time: string; color: string }[] = []
  if (escrowQuery.escrow?.state === 'funded') {
    activityRows.push({
      label: 'Escrow funded',
      detail: formatUsdc(escrowQuery.escrow.amountUsdc),
      time: '—',
      color: '#F2A340',
    })
  }
  const recentReports: ChainReport[] = reportsQuery.reports.slice(0, 5)
  for (const r of recentReports) {
    activityRows.push({
      label: `Scout · ${r.aiLabel.slice(0, 24)}`,
      detail: r.aiLabel,
      time: formatShortDate(r.timestamp),
      color: activityColor(r.aiLabel, r.status),
    })
  }

  if (loading) return <ProfileSkeleton />

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* ── Setup banner ─────────────────────────────────────── */}
        {!setupProgressState.complete && (
          <View style={styles.setupBanner}>
            <View style={styles.setupBannerHead}>
              <Text style={styles.setupBannerTitle}>{t('profile.setup.title')}</Text>
              <Text style={styles.setupBannerCount}>
                {t('profile.setup.body', { done: setupProgressState.done, total: setupProgressState.total })}
              </Text>
            </View>
            <View style={styles.setupBar}>
              {setupProgressState.items.map((item) => (
                <View key={item.key} style={[styles.setupSeg, item.done && styles.setupSegDone]} />
              ))}
            </View>
            <Pressable
              style={styles.setupCta}
              onPress={() => {
                Haptics.selectionAsync()
                router.push('/setup')
              }}
              accessibilityRole="button"
              accessibilityLabel={t('profile.setup.cta')}
            >
              <Text style={styles.setupCtaText}>{t('profile.setup.cta')}</Text>
              <Svg width={8} height={12} viewBox="0 0 8 12" fill="none">
                <Path
                  d="M2 2 L6 6 L2 10"
                  stroke={colors.amber}
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </Pressable>
          </View>
        )}

        {/* ── Identity ──────────────────────────────────────────── */}
        <View style={styles.identity}>
          <View style={styles.avatar}>
            {profile?.photoUri ? (
              <Image source={{ uri: profile.photoUri }} style={styles.avatarImg} />
            ) : initials ? (
              <Text style={styles.avatarText}>{initials}</Text>
            ) : (
              <PersonIcon color={colors.amber} size={32} />
            )}
          </View>
          <Text style={styles.name}>{displayName}</Text>
          <Text style={styles.handle}>{handle}</Text>
          {profile?.bio ? (
            <Text style={styles.bio} numberOfLines={3}>
              {profile.bio}
            </Text>
          ) : null}
          <View style={styles.roleChip}>
            <Text style={styles.roleText}>Farm Operator</Text>
          </View>
        </View>

        {/* ── Wallet ────────────────────────────────────────────── */}
        <Card style={styles.walletCard}>
          {!isConnected && (
            <View style={styles.connectPrompt}>
              <Text style={styles.connectTitle}>{t('profile.connectPrompt')}</Text>
              <Text style={styles.connectMessage}>{t('profile.connectPromptBody')}</Text>
            </View>
          )}

          <View style={styles.walletTop}>
            <SectionLabel style={{ marginBottom: 0 }}>{t('profile.walletBalance')}</SectionLabel>
            <View style={styles.networkChip}>
              <View style={[styles.networkDot, { backgroundColor: isConnected ? colors.sage : colors.textDim }]} />
              <Text style={styles.networkText}>
                {isConnected ? t(CLUSTER_LABEL_KEYS[network.cluster]) : t('profile.offline')}
              </Text>
            </View>
          </View>

          <View style={[styles.balances, !isConnected && styles.dimmed]}>
            <View>
              <Text style={styles.balanceLabel}>SOL</Text>
              <Text style={styles.solValue}>{solDisplay}</Text>
            </View>
            <View style={styles.usdcBox}>
              <Text style={styles.balanceLabel}>USDC</Text>
              <Text style={styles.usdcValue}>{usdcDisplay}</Text>
            </View>
          </View>

          <Divider style={styles.walletDivider} />

          <View style={styles.walletMiniRow}>
            <View>
              <Text style={styles.balanceLabel}>{t('profile.escrowLocked')}</Text>
              <Text style={styles.escrowValue}>{escrowDisplay}</Text>
            </View>
            <View style={styles.usdcBox}>
              <Text style={styles.balanceLabel}>{t('profile.nftCerts')}</Text>
              <Text style={styles.nftValue}>{nftCerts}</Text>
            </View>
          </View>

          {isConnected && displayName && (
            <View style={styles.pubkeyBox}>
              <Text style={styles.balanceLabel}>{t('profile.wallet')}</Text>
              <Text style={styles.walletName}>{displayName}</Text>
            </View>
          )}

          <View style={[styles.pubkeyBox, isConnected && styles.pubkeyBoxFollow]}>
            <Text style={styles.balanceLabel}>{t('profile.pubkey')}</Text>
            <Text style={[styles.pubkey, !pubkey && styles.valueMuted]}>{pubkey ?? t('profile.notConnected')}</Text>
          </View>

          <Pressable
            style={[styles.walletAction, isConnected && styles.walletActionMuted]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
              void toggleConnection()
            }}
            accessibilityRole="button"
            accessibilityLabel={isConnected ? t('wallet.disconnect') : t('wallet.connect')}
            accessibilityState={{ busy: isConnecting }}
            disabled={isConnecting}
          >
            {isConnecting ? (
              <ActivityIndicator size="small" color={colors.textSecondary} />
            ) : (
              <FontAwesome5
                name={isConnected ? 'link-slash' : 'wallet'}
                size={15}
                color={isConnected ? colors.textSecondary : colors.surface}
              />
            )}
            <Text style={[styles.walletActionText, isConnected && styles.walletActionTextMuted]}>
              {isConnected ? t('wallet.disconnect') : t('wallet.connect')}
            </Text>
          </Pressable>
        </Card>

        {/* ── Farm details ──────────────────────────────────────── */}
        <Card>
          <SectionLabel>{t('profile.farmDetails')}</SectionLabel>
          {[
            { key: 'profile.farm', value: farmName },
            { key: 'profile.location', value: farmLocation },
            { key: 'profile.season', value: farmSeason },
            { key: 'profile.totalAcres', value: farmAcres },
            { key: 'profile.memberSince', value: memberSince },
          ].map((row) => (
            <View key={row.key} style={styles.detailRow}>
              <Text style={styles.detailLabel}>{t(row.key as MessageKey)}</Text>
              <Text style={styles.detailValue}>{row.value}</Text>
            </View>
          ))}
        </Card>

        {/* ── Activity ──────────────────────────────────────────── */}
        <Card>
          <SectionLabel>{t('profile.recentActivity')}</SectionLabel>
          {activityRows.length === 0 ? (
            <EmptyState title={t('profile.empty.activity')} message={t('profile.empty.activityBody')} />
          ) : (
            activityRows.map((item, i) => (
              <View
                key={`${item.label}-${i}`}
                style={[styles.activityRow, i < activityRows.length - 1 && styles.activityRowSpaced]}
              >
                <View style={[styles.activityDot, { backgroundColor: item.color }]} />
                <View style={styles.activityBody}>
                  <Text style={styles.activityLabel} numberOfLines={1}>
                    {item.label}
                  </Text>
                  <Text style={styles.activityDetail} numberOfLines={1}>
                    {item.detail}
                  </Text>
                </View>
                <Text style={styles.activityTime}>{item.time}</Text>
              </View>
            ))
          )}
        </Card>

        {/* ── Settings ──────────────────────────────────────────── */}
        <Card>
          <SectionLabel style={styles.settingsLabel}>{t('profile.settings')}</SectionLabel>
          {SETTINGS.map((item, i) => {
            const label =
              item.key === 'settings.network'
                ? t('settings.network', { cluster: t(CLUSTER_LABEL_KEYS[network.cluster]) })
                : t(item.key)
            return (
              <Pressable
                key={item.key}
                style={[styles.settingRow, i < SETTINGS.length - 1 && styles.settingRowBordered]}
                onPress={() => {
                  Haptics.selectionAsync()
                  router.push(item.route)
                }}
                accessibilityRole="button"
                accessibilityLabel={label}
              >
                <View style={styles.settingIcon}>
                  <FontAwesome5 name={item.icon} size={17} color={colors.textPrimary} />
                </View>
                <Text style={styles.settingLabel}>{label}</Text>
                <Svg width={8} height={12} viewBox="0 0 8 12" fill="none">
                  <Path
                    d="M2 2 L6 6 L2 10"
                    stroke={colors.textDim}
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
              </Pressable>
            )
          })}
        </Card>
      </ScrollView>
    </View>
  )
}

/* ── Loading skeleton ───────────────────────────────────────────────────────── */

function ProfileSkeleton() {
  const styles = makeStyles(useTheme().colors)
  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.identity}>
          <Skeleton height={72} width={72} radius={36} />
          <Skeleton height={16} width={140} style={{ marginTop: spacing.md }} />
          <Skeleton height={10} width={90} style={{ marginTop: 6 }} />
        </View>

        <Card>
          <Skeleton height={9} width={110} />
          <View style={styles.balances}>
            <Skeleton height={30} width={100} />
            <Skeleton height={22} width={80} />
          </View>
          <Skeleton height={4} />
          <Skeleton height={40} style={{ marginTop: spacing.lg }} />
          <Skeleton height={52} style={{ marginTop: spacing.lg }} />
        </Card>

        <Card>
          <Skeleton height={9} width={90} />
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={13} style={{ marginTop: spacing.md }} />
          ))}
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

    // Setup banner — hides itself once all four signals are done (or deferred).
    setupBanner: {
      backgroundColor: colors.amberDim,
      borderWidth: 1,
      borderColor: `${colors.amber}59`,
      borderRadius: radii.lg,
      padding: spacing.lg,
    },
    setupBannerHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    setupBannerTitle: {
      fontSize: fontSizes.md,
      fontWeight: fontWeights.semibold,
      color: colors.textPrimary,
      flexShrink: 1,
    },
    setupBannerCount: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xxs,
      color: colors.amber,
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    setupBar: { flexDirection: 'row', gap: 4, marginTop: spacing.sm },
    setupSeg: { flex: 1, height: 5, borderRadius: radii.full, backgroundColor: colors.borderMid },
    setupSegDone: { backgroundColor: colors.sage },
    setupCta: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      marginTop: spacing.md,
      borderWidth: 1,
      borderColor: colors.amber,
      borderRadius: radii.md,
      paddingVertical: spacing.sm + 2,
    },
    setupCtaText: { fontSize: fontSizes.base, fontWeight: fontWeights.semibold, color: colors.amber },

    identity: { alignItems: 'center', paddingVertical: spacing.lg },
    avatar: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: colors.borderMid,
      borderWidth: 2,
      borderColor: colors.amber,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.md,
      overflow: 'hidden',
    },
    avatarImg: { width: '100%', height: '100%', borderRadius: 36 },
    avatarText: { fontSize: fontSizes['4xl'], fontWeight: fontWeights.bold, color: colors.amber },
    name: { fontSize: fontSizes['2xl'], fontWeight: fontWeights.bold, color: colors.textPrimary, marginBottom: 2 },
    handle: { fontFamily: 'monospace', fontSize: fontSizes.sm, color: colors.textMuted, marginBottom: spacing.xs },
    bio: {
      fontSize: fontSizes.base,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 17,
      paddingHorizontal: spacing.xl,
      marginBottom: spacing.sm,
    },
    roleChip: {
      backgroundColor: colors.amberDim,
      borderWidth: 1,
      borderColor: `${colors.amber}59`,
      borderRadius: radii.full,
      paddingHorizontal: spacing.lg,
      paddingVertical: 3,
    },
    roleText: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xxs,
      color: colors.amber,
      letterSpacing: 1.5,
      textTransform: 'uppercase',
    },

    walletCard: { backgroundColor: colors.surfaceAlt },
    dimmed: { opacity: 0.45 },
    valueMuted: { color: colors.textDim },
    connectTitle: {
      fontSize: fontSizes.lg,
      fontWeight: fontWeights.semibold,
      color: colors.textPrimary,
      marginBottom: 6,
    },
    connectMessage: { fontSize: fontSizes.base, color: colors.textMuted, lineHeight: 18 },
    connectPrompt: {
      marginBottom: spacing.lg,
      paddingBottom: spacing.lg,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    walletTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.lg,
    },
    networkChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.full,
      paddingHorizontal: spacing.sm + 1,
      paddingVertical: 3,
    },
    networkDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.sage },
    networkText: { fontFamily: 'monospace', fontSize: fontSizes.xxs, color: colors.textMuted },
    balances: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      marginBottom: spacing.lg,
    },
    usdcBox: { alignItems: 'flex-end' },
    balanceLabel: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xxs,
      color: colors.textDim,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      marginBottom: 4,
    },
    solValue: { fontSize: fontSizes['5xl'], fontWeight: fontWeights.bold, color: colors.sol, lineHeight: 34 },
    usdcValue: { fontSize: fontSizes['3xl'], fontWeight: fontWeights.bold, color: colors.sky, lineHeight: 24 },
    walletDivider: { marginBottom: spacing.lg },
    walletMiniRow: { flexDirection: 'row', justifyContent: 'space-between' },
    escrowValue: { fontSize: fontSizes.xl, fontWeight: fontWeights.bold, color: colors.amber },
    nftValue: { fontSize: fontSizes.xl, fontWeight: fontWeights.bold, color: colors.sageLight },
    pubkeyBox: {
      marginTop: spacing.lg,
      backgroundColor: colors.surface,
      borderRadius: radii.sm,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md + 1,
    },
    pubkeyBoxFollow: { marginTop: spacing.sm },
    walletName: { fontSize: fontSizes.md, fontWeight: fontWeights.semibold, color: colors.amberLight },
    pubkey: { fontFamily: 'monospace', fontSize: fontSizes.sm, color: colors.sky },
    walletAction: {
      marginTop: spacing.lg,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.amber,
      backgroundColor: colors.amber,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.xl,
    },
    walletActionMuted: { backgroundColor: 'transparent', borderColor: colors.borderMid },
    walletActionText: { fontSize: fontSizes.base, fontWeight: fontWeights.semibold, color: colors.surface },
    walletActionTextMuted: { color: colors.textSecondary },

    detailRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: spacing.md - 2,
      marginBottom: spacing.md - 2,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    detailLabel: { fontFamily: 'monospace', fontSize: fontSizes.xs, color: colors.textMuted, letterSpacing: 0.5 },
    detailValue: {
      fontSize: fontSizes.base,
      fontWeight: fontWeights.medium,
      color: colors.textPrimary,
      flexShrink: 1,
      textAlign: 'right',
      marginLeft: spacing.md,
    },

    activityRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    activityRowSpaced: { marginBottom: spacing.md },
    activityDot: { width: 8, height: 8, borderRadius: 4 },
    activityBody: { flex: 1, minWidth: 0 },
    activityLabel: {
      fontSize: fontSizes.base,
      fontWeight: fontWeights.medium,
      color: colors.textPrimary,
      marginBottom: 1,
    },
    activityDetail: { fontFamily: 'monospace', fontSize: fontSizes.xs, color: colors.textMuted },
    activityTime: { fontFamily: 'monospace', fontSize: fontSizes.xxs, color: colors.textDim },

    settingsLabel: { marginBottom: spacing.sm },
    settingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md + 1 },
    settingRowBordered: { borderBottomWidth: 1, borderBottomColor: colors.border },
    settingIcon: { width: 18, alignItems: 'center' },
    settingLabel: { flex: 1, fontSize: fontSizes.md, color: colors.textPrimary },
  })
