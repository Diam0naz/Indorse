/**
 * components/app-header.tsx — Persistent app header
 *
 * Rendered once above the tab navigator: a time-of-day greeting and the
 * operator's wallet name, the notification bell (opens the sheet) and the
 * avatar shortcut to the Profile tab. The current-farm pill sits underneath
 * and is hidden while the Profile tab is active.
 *
 * The pill features whatever farm is current in FarmRegistryProvider — the
 * selection made in the switcher sheet (or the first/only farm), so any of
 * the operator's farms can be the one every screen shares. With no farms it
 * becomes an "add your first farm" prompt that opens the register modal;
 * with farms it opens the switcher.
 *
 * A raw pubkey never appears in the header — the greeting addresses the
 * operator by full name (real onboarding name first, then .skr,
 * then the wallet's generated label) and falls back to a "connect your
 * wallet" prompt until onboarding is done. The avatar follows the same
 * ladder: photo → name initials → person icon (never demo initials).
 *
 * The unread dot follows the badge preference from notification settings.
 */

import { useState } from 'react'
import { Image, Pressable, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Svg, { Path } from 'react-native-svg'
import { router, usePathname } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { NotificationsSheet, useNotifications } from '@/components/notifications'
import { useFarmRegistry } from '@/components/farm-registry-provider'
import { FarmSwitcherSheet } from '@/components/farm-switcher-sheet'
import { PersonIcon } from '@/components/person-icon'
import { RegisterFarmModal } from '@/components/register-farm-modal'
import { useProfile } from '@/components/profile-provider'
import { useSettings } from '@/components/settings-provider'
import { useTheme } from '@/components/theme-provider'
import { useMobileWalletSetup } from '@/features/wallet'
import { createStyles, fontSizes, fontWeights, fonts, radii, spacing, type Colors } from '@/constants/theme'
import { initialsOf } from '@/lib/display-name'
import { greetingKey } from '@/lib/greeting'
import { walletName } from '@/lib/wallet-name'
import { useSkrName } from '@/lib/skr'
import { useT } from '@/lib/i18n'

const PROFILE_ROUTE = '/(tabs)/rewards'

export function AppHeader() {
  const [sheetOpen, setSheetOpen] = useState(false)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [registerOpen, setRegisterOpen] = useState(false)
  const { unread } = useNotifications()
  const { notifications } = useSettings()
  const { profile } = useProfile()
  const { farms, current } = useFarmRegistry()
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const t = useT()
  const pathname = usePathname()
  const onProfile = pathname.startsWith('/rewards')
  const showBadge = notifications.push && notifications.badge && unread > 0

  // Greeting + identity, resolved once per render.
  const { address, walletState } = useMobileWalletSetup()
  const isConnected = walletState === 'connected'
  const greeting = t(greetingKey())
  // Real onboarding name first, then .skr, then the wallet's generated
  // label — shown in full. Guests keep the prompt.
  const skrName = useSkrName(address)
  const realName = profile?.name?.trim() || null
  const identityName = realName ?? (isConnected ? (skrName ?? walletName(address)) : null)
  const identity = identityName ? identityName : t('header.connectWallet')
  const identityPrompt = identityName === null
  // Avatar ladder: photo → initials of the real/wallet name → person icon.
  const avatarInitials = realName ? initialsOf(realName) : isConnected ? initialsOf(walletName(address)) : ''

  function openProfile() {
    Haptics.selectionAsync()
    if (!onProfile) router.push(PROFILE_ROUTE)
  }

  /** No farms yet → straight into the register modal; otherwise the switcher. */
  function openFarmPicker() {
    Haptics.selectionAsync()
    if (farms.length === 0) setRegisterOpen(true)
    else setSwitcherOpen(true)
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.row}>
        <View style={styles.brand}>
          <View style={styles.brandText}>
            <Text style={styles.greeting} numberOfLines={1}>
              {greeting}
            </Text>
            <Text
              style={[styles.identity, identityPrompt && styles.identityPrompt]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {identity}
            </Text>
          </View>
        </View>

        <View style={styles.actions}>
          <Pressable
            style={styles.iconBtn}
            onPress={() => {
              Haptics.selectionAsync()
              setSheetOpen(true)
            }}
            accessibilityRole="button"
            accessibilityLabel={`${t('notif.title')}${unread > 0 ? `, ${t('notif.unread', { n: unread })}` : ''}`}
          >
            <Svg width={16} height={16} viewBox="0 0 16 16" fill="none">
              <Path
                d="M8 2C5.8 2 4 3.8 4 6v3l-1.5 2h11L12 9V6c0-2.2-1.8-4-4-4z"
                stroke={colors.textMuted}
                strokeWidth={1.3}
                fill="none"
              />
              <Path
                d="M6.5 13c0 .8.7 1.5 1.5 1.5s1.5-.7 1.5-1.5"
                stroke={colors.textMuted}
                strokeWidth={1.3}
                strokeLinecap="round"
              />
            </Svg>
            {showBadge && <View style={styles.unreadDot} />}
          </Pressable>

          <Pressable
            style={[styles.avatar, onProfile && { backgroundColor: `${colors.amber}33`, borderColor: colors.amber }]}
            onPress={openProfile}
            accessibilityRole="button"
            accessibilityLabel={t('tabs.profile')}
          >
            {profile?.photoUri ? (
              <Image source={{ uri: profile.photoUri }} style={styles.avatarImg} />
            ) : avatarInitials ? (
              <Text style={[styles.avatarText, onProfile && { color: colors.amber }]}>{avatarInitials}</Text>
            ) : (
              <PersonIcon color={onProfile ? colors.amber : colors.textMuted} size={20} testID="headerAvatarIcon" />
            )}
          </Pressable>
        </View>
      </View>

      {!onProfile && (
        <View style={styles.pillWrap}>
          <Pressable
            style={styles.pill}
            onPress={openFarmPicker}
            accessibilityRole="button"
            accessibilityLabel={
              current
                ? `${current.name}, ${t('header.switchFarm')}`
                : `${t('header.noFarm')}, ${t('header.addFarmHint')}`
            }
          >
            <View style={styles.pillMain}>
              <Text style={styles.pillName}>{current ? current.name : t('header.noFarm')}</Text>
              <Text style={styles.pillMeta}>
                {current
                  ? `${current.lat.toFixed(4)}, ${current.lng.toFixed(4)} · ${
                      current.source === 'chain' ? t('header.onChain') : t('header.local')
                    }`
                  : t('header.addFarmHint')}
              </Text>
            </View>
            {current && (
              <View style={styles.pillAcres}>
                <Text style={styles.pillAcresValue}>
                  {current.source === 'chain' ? String(current.reportCount ?? 0) : '—'}
                </Text>
                <Text style={styles.pillAcresLabel}>
                  {current.source === 'chain' ? t('header.reports') : t('header.local')}
                </Text>
              </View>
            )}
          </Pressable>
        </View>
      )}

      <NotificationsSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
      <FarmSwitcherSheet
        visible={switcherOpen}
        onClose={() => setSwitcherOpen(false)}
        onAddFarm={() => setRegisterOpen(true)}
      />
      {registerOpen && <RegisterFarmModal onClose={() => setRegisterOpen(false)} />}
    </SafeAreaView>
  )
}

/* ── Styles ────────────────────────────────────────────────────────────────── */

const makeStyles = (colors: Colors) =>
  createStyles({
    safe: {
      backgroundColor: colors.surface,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.sm,
      paddingBottom: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    brand: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    brandText: {
      flexShrink: 1,
      minWidth: 0,
    },
    // The greeting is the header's one piece of calligraphy. Great Vibes is a
    // formal script — flourished capitals, long looping ascenders and
    // descenders — so it runs well above the app's display sizes and carries
    // no `fontWeight` (400 is the only cut Google ships for it). The opening
    // swash overshoots the glyph origin to the left, so `paddingLeft` keeps it
    // inside the text box instead of clipping at the layout edge.
    greeting: {
      fontFamily: fonts.script.regular,
      fontSize: 27,
      lineHeight: 32,
      paddingLeft: spacing.sm,
      color: colors.textPrimary,
    },
    // The name under the greeting — same left inset as the script above so
    // both lines start on one margin.
    identity: {
      fontFamily: fonts.display.medium,
      fontSize: fontSizes.base,
      lineHeight: 13,
      letterSpacing: 0.1,
      color: colors.amberLight,
      paddingLeft: spacing.sm,
      marginTop: -1,
    },
    // Not connected yet — an action prompt rather than a name.
    identityPrompt: {
      color: colors.textDim,
    },
    actions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    iconBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    unreadDot: {
      position: 'absolute',
      top: 6,
      right: 6,
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: colors.danger,
      borderWidth: 1.5,
      borderColor: colors.surface,
    },
    avatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.borderMid,
      borderWidth: 1.5,
      borderColor: colors.borderHi,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    avatarImg: { width: '100%', height: '100%', borderRadius: 18 },
    avatarText: {
      fontSize: fontSizes.sm,
      fontWeight: fontWeights.bold,
      color: colors.amber,
    },
    pillWrap: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.sm,
    },
    pill: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: colors.surfaceAlt,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md + 2,
    },
    pillMain: {
      flex: 1,
      minWidth: 0,
      paddingRight: spacing.md,
    },
    pillName: {
      fontSize: fontSizes.md,
      fontWeight: fontWeights.semibold,
      color: colors.textPrimary,
    },
    pillMeta: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xs,
      color: colors.textMuted,
      marginTop: 2,
    },
    pillAcres: {
      alignItems: 'flex-end',
    },
    pillAcresValue: {
      fontSize: fontSizes.xl,
      fontWeight: fontWeights.bold,
      color: colors.amber,
    },
    pillAcresLabel: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xxs,
      color: colors.textMuted,
    },
  })
