/**
 * app/(tabs)/_layout.tsx — Bottom Tab Navigator
 *
 * Four tabs: Scout, Provenance, Weather, Profile.
 * A custom tab bar renders the SVG icons, the amber active indicator and the
 * small count / beta badges from the Figma design. Labels follow the active
 * language, the count badge follows the unread notification count (and its
 * badge preference), and the palette follows the active theme.
 */

import { Pressable, Text, View } from 'react-native'
import Svg, { Circle, Path, Rect } from 'react-native-svg'
import { Tabs } from 'expo-router'
import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs/types'
import * as Haptics from 'expo-haptics'
import { AppHeader } from '@/components/app-header'
import { HelpChip } from '@/components/help-chip'
import { FarmChainSync } from '@/features/farm/FarmChainSync'
import { NotificationsProvider, useNotifications } from '@/components/notifications'
import { useSettings } from '@/components/settings-provider'
import { useTheme } from '@/components/theme-provider'
import { createStyles, fontSizes, fontWeights, spacing, type Colors } from '@/constants/theme'
import { useT, type MessageKey } from '@/lib/i18n'

/* ── Tab icon components ────────────────────────────────────────────── */

function ScoutIcon({ active }: { active: boolean }) {
  const { colors } = useTheme()
  const c = active ? colors.amber : colors.textDim
  return (
    <Svg width={22} height={22} viewBox="0 0 22 22" fill="none">
      <Circle cx={11} cy={10} r={5} stroke={c} strokeWidth={1.5} />
      <Path d="M11 5v-2M11 17v-2M5 10H3M19 10h-2" stroke={c} strokeWidth={1.5} strokeLinecap="round" />
      <Circle cx={11} cy={10} r={1.5} fill={c} />
      <Path d="M14.5 13.5L18 17" stroke={c} strokeWidth={1.5} strokeLinecap="round" />
    </Svg>
  )
}

function ProvenanceIcon({ active }: { active: boolean }) {
  const { colors } = useTheme()
  const c = active ? colors.amber : colors.textDim
  return (
    <Svg width={22} height={22} viewBox="0 0 22 22" fill="none">
      <Rect x={4} y={4} width={14} height={14} rx={2} stroke={c} strokeWidth={1.5} />
      <Path d="M7 8h8M7 11h8M7 14h5" stroke={c} strokeWidth={1.5} strokeLinecap="round" />
      <Circle cx={16} cy={16} r={3} fill={active ? colors.amber : colors.surface} stroke={c} strokeWidth={1.2} />
      <Path
        d="M15 16l.8.8L17 15.5"
        stroke={active ? colors.surface : c}
        strokeWidth={1}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  )
}

function WeatherIcon({ active }: { active: boolean }) {
  const { colors } = useTheme()
  const c = active ? colors.amber : colors.textDim
  return (
    <Svg width={22} height={22} viewBox="0 0 22 22" fill="none">
      <Path
        d="M7 14.5C5 14.5 4 13 4 11.5c0-1.5 1.2-2.7 2.7-2.8C7 6.6 8.8 5 11 5c2.5 0 4.5 2 4.5 4.5 1.4 0 2.5 1.1 2.5 2.5s-1.1 2.5-2.5 2.5H7z"
        stroke={c}
        strokeWidth={1.4}
        fill="none"
      />
      <Path d="M9 17v2M11 16v2M13 17v2" stroke={c} strokeWidth={1.4} strokeLinecap="round" />
    </Svg>
  )
}

function ProfileIcon({ active }: { active: boolean }) {
  const { colors } = useTheme()
  const c = active ? colors.amber : colors.textDim
  return (
    <Svg width={22} height={22} viewBox="0 0 22 22" fill="none">
      <Circle cx={11} cy={9} r={3.5} stroke={c} strokeWidth={1.5} />
      <Path d="M4 19c0-3.9 3.1-7 7-7s7 3.1 7 7" stroke={c} strokeWidth={1.5} strokeLinecap="round" />
    </Svg>
  )
}

/* ── Tab metadata ───────────────────────────────────────────────────── */

const LABEL_KEYS: Record<string, MessageKey> = {
  index: 'tabs.scout',
  farms: 'tabs.provenance',
  reports: 'tabs.weather',
  rewards: 'tabs.profile',
}

function TabIcon({ name, active }: { name: string; active: boolean }) {
  if (name === 'farms') return <ProvenanceIcon active={active} />
  if (name === 'reports') return <WeatherIcon active={active} />
  if (name === 'rewards') return <ProfileIcon active={active} />
  return <ScoutIcon active={active} />
}

/* ── Custom tab bar ─────────────────────────────────────────────────── */

function IndorseTabBar({ state, navigation, descriptors }: BottomTabBarProps) {
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const t = useT()
  const { unread } = useNotifications()
  const { notifications } = useSettings()
  // Unread count is hidden entirely when the badge preference is off.
  const showCount = notifications.push && notifications.badge && unread > 0

  return (
    <View style={styles.tabBar}>
      {state.routes.map((route, index) => {
        const focused = state.index === index
        const labelKey = LABEL_KEYS[route.name]
        const label = labelKey ? t(labelKey) : (descriptors[route.key].options.title ?? route.name)
        const badge =
          route.name === 'index' && showCount
            ? { label: String(unread), bg: colors.danger }
            : route.name === 'reports'
              ? { label: 'β', bg: colors.textDim }
              : undefined

        return (
          <Pressable
            key={route.key}
            style={styles.tabBtn}
            accessibilityRole="button"
            accessibilityState={focused ? { selected: true } : {}}
            accessibilityLabel={label}
            onPress={() => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              })
              if (!focused && !event.defaultPrevented) {
                Haptics.selectionAsync()
                navigation.navigate(route.name)
              }
            }}
            onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
          >
            <View style={styles.iconWrap}>
              <TabIcon name={route.name} active={focused} />
              {badge && (
                <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                  <Text style={styles.badgeText}>{badge.label}</Text>
                </View>
              )}
            </View>
            <Text style={[styles.tabLabel, { color: focused ? colors.amber : colors.textDim }]}>{label}</Text>
            {focused && <View style={styles.activeIndicator} />}
          </Pressable>
        )
      })}
    </View>
  )
}

/* ── Layout ─────────────────────────────────────────────────────────── */

export default function TabsLayout() {
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  return (
    <NotificationsProvider>
      <View style={styles.root}>
        <FarmChainSync />
        <AppHeader />
        <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <IndorseTabBar {...props} />}>
          <Tabs.Screen name="index" options={{ title: 'Scout' }} />
          <Tabs.Screen name="farms" options={{ title: 'Provenance' }} />
          <Tabs.Screen name="reports" options={{ title: 'Weather' }} />
          <Tabs.Screen name="rewards" options={{ title: 'Profile' }} />
        </Tabs>
        {/* "Ask indorse" — one floating help chip over every tab, bottom-left
            so it stays clear of the Scout dock at bottom-right. */}
        <HelpChip />
      </View>
    </NotificationsProvider>
  )
}

/* ── Styles ─────────────────────────────────────────────────────────── */

const makeStyles = (colors: Colors) =>
  createStyles({
    root: {
      flex: 1,
      backgroundColor: colors.surface,
    },
    tabBar: {
      flexDirection: 'row',
      backgroundColor: colors.surface,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: spacing.xs,
      // Lifts the icons and labels clear of the gesture/navigation inset. The
      // height tracks the padding so the row itself is not squeezed.
      paddingBottom: spacing['3xl'],
      height: 90,
    },
    tabBtn: {
      flex: 1,
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      paddingTop: spacing.xs,
      gap: 4,
      position: 'relative',
    },
    iconWrap: {
      width: 24,
      height: 22,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badge: {
      position: 'absolute',
      top: -7,
      right: -13,
      minWidth: 14,
      height: 13,
      borderRadius: 7,
      paddingHorizontal: 4,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeText: {
      color: colors.textPrimary,
      fontFamily: 'monospace',
      fontSize: 8,
      fontWeight: fontWeights.medium,
    },
    tabLabel: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xxs,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    activeIndicator: {
      position: 'absolute',
      bottom: -spacing.xs,
      width: 28,
      height: 2,
      backgroundColor: colors.amber,
      borderRadius: 1,
    },
  })
