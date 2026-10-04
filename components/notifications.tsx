/**
 * components/notifications.tsx — Notification state + bottom sheet
 *
 * The unread badge lives in the app header and the sheet is opened from it,
 * so the read/unread state is shared through a small context provider that
 * wraps the tab navigator.
 *
 * The provider also honours the preferences from `SettingsProvider`: the
 * master push switch and the per-category switches decide which items reach
 * the feed, which is what the notification settings screen edits.
 */

import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from 'react'
import { Modal, Pressable, ScrollView, Text, View } from 'react-native'
import { createStyles, fontSizes, fontWeights, notifColorsFor, radii, spacing, type Colors } from '@/constants/theme'
import { NOTIFICATIONS, type Notification } from '@/constants/data'
import { EmptyState } from '@/components/screen-kit'
import { useTheme } from '@/components/theme-provider'
import { useSettings, type NotificationPrefs } from '@/components/settings-provider'
import { useT } from '@/lib/i18n'

/* ── Context ───────────────────────────────────────────────────────────────── */

/** What a caller supplies to `add` — id/time/read are the provider's job. */
export type NotificationDraft = Omit<Notification, 'id' | 'read' | 'time'>

interface NotificationsContextValue {
  items: Notification[]
  unread: number
  /** Master switch + category switches from notification settings. */
  enabled: boolean
  /**
   * Push a new item to the top of the feed (e.g. the AI diagnosis after a
   * scan). It still passes through the same preference filter as the seeded
   * items — type 'alert'/'scout' is gated by the diagnosis switch.
   */
  add: (draft: NotificationDraft) => string
  markRead: (id: string) => void
  markAllRead: () => void
  clear: () => void
}

/** Default context (no provider — every test renders without one). */
const NotificationsContext = createContext<NotificationsContextValue>({
  items: [],
  unread: 0,
  enabled: true,
  add: () => '',
  markRead: () => {},
  markAllRead: () => {},
  clear: () => {},
})

/** Which preference switch gates a given notification type. */
function categoryEnabled(prefs: NotificationPrefs, type: Notification['type']): boolean {
  switch (type) {
    case 'alert':
    case 'scout':
      return prefs.diagnosis
    case 'escrow':
      return prefs.escrow
    case 'weather':
      return prefs.weather
    default:
      return prefs.system
  }
}

export function NotificationsProvider({ children }: PropsWithChildren) {
  const [items, setItems] = useState<Notification[]>(() => NOTIFICATIONS.map((n) => ({ ...n })))
  const { notifications: prefs } = useSettings()

  const add = useCallback((draft: NotificationDraft) => {
    const id = `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    setItems((prev) => [{ ...draft, id, time: 'just now', read: false }, ...prev])
    return id
  }, [])

  const markRead = useCallback((id: string) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
  }, [])

  const markAllRead = useCallback(() => {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })))
  }, [])

  const clear = useCallback(() => setItems([]), [])

  // Feed = items whose category is switched on (and only while the master
  // push switch is on). Turning everything off exercises the empty state.
  const feed = useMemo(() => (prefs.push ? items.filter((n) => categoryEnabled(prefs, n.type)) : []), [items, prefs])

  const unread = feed.filter((n) => !n.read).length

  const value = useMemo(
    () => ({ items: feed, unread, enabled: prefs.push, add, markRead, markAllRead, clear }),
    [feed, unread, prefs.push, add, markRead, markAllRead, clear],
  )

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
}

export function useNotifications(): NotificationsContextValue {
  return useContext(NotificationsContext)
}

/* ── Bottom sheet ──────────────────────────────────────────────────────────── */

export function NotificationsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { items, unread, markRead, markAllRead, clear } = useNotifications()
  const { colors } = useTheme()
  const notifColors = notifColorsFor(colors)
  const styles = makeStyles(colors)
  const t = useT()

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTap} onPress={onClose} accessibilityLabel={t('notif.close')} />
        <View style={styles.sheet}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <View>
              <Text style={styles.title}>{t('notif.title')}</Text>
              {unread > 0 && <Text style={styles.unreadLabel}>{t('notif.unread', { n: unread })}</Text>}
            </View>
            <View style={styles.headerActions}>
              {items.length > 0 && (
                <>
                  {unread > 0 && (
                    <Pressable onPress={markAllRead} hitSlop={8} accessibilityRole="button">
                      <Text style={styles.markAll}>{t('notif.markAll')}</Text>
                    </Pressable>
                  )}
                  <Pressable onPress={clear} hitSlop={8} accessibilityRole="button">
                    <Text style={styles.clearAll}>{t('notif.clear')}</Text>
                  </Pressable>
                </>
              )}
              <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={8} accessibilityLabel={t('notif.close')}>
                <Text style={styles.closeText}>×</Text>
              </Pressable>
            </View>
          </View>

          <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
            {items.length === 0 && <EmptyState title={t('notif.caughtUp')} message={t('notif.caughtUpBody')} />}
            {items.map((n) => (
              <Pressable
                key={n.id}
                onPress={() => markRead(n.id)}
                style={[
                  styles.row,
                  {
                    backgroundColor: n.read ? colors.surface : colors.surfaceAlt,
                    borderColor: n.read ? colors.border : colors.borderMid,
                  },
                ]}
              >
                <View
                  style={[
                    styles.rowIcon,
                    { backgroundColor: `${notifColors[n.type]}18`, borderColor: `${notifColors[n.type]}40` },
                  ]}
                >
                  <View style={[styles.rowDot, { backgroundColor: notifColors[n.type] }]} />
                </View>
                <View style={styles.rowBody}>
                  <View style={styles.rowTop}>
                    <Text style={[styles.rowTitle, { fontWeight: n.read ? fontWeights.medium : fontWeights.bold }]}>
                      {n.title}
                    </Text>
                    <Text style={styles.rowTime}>{n.time}</Text>
                  </View>
                  <Text style={styles.rowText}>{n.body}</Text>
                </View>
                {!n.read && <View style={styles.unreadDot} />}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

/* ── Styles ────────────────────────────────────────────────────────────────── */

const makeStyles = (colors: Colors) =>
  createStyles({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(6,7,8,0.7)',
      justifyContent: 'flex-end',
    },
    backdropTap: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    },
    sheet: {
      height: '78%',
      backgroundColor: colors.surface,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      borderWidth: 1,
      borderColor: colors.border,
      paddingBottom: spacing['2xl'],
      overflow: 'hidden',
    },
    handle: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.borderMid,
      alignSelf: 'center',
      marginTop: 10,
      marginBottom: 6,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.sm,
      paddingBottom: spacing.lg,
    },
    title: {
      fontSize: fontSizes['2xl'],
      fontWeight: fontWeights.bold,
      color: colors.textPrimary,
    },
    unreadLabel: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xs,
      color: colors.amber,
      marginTop: 2,
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    markAll: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xs,
      color: colors.sky,
      letterSpacing: 0.8,
    },
    clearAll: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xs,
      color: colors.textMuted,
      letterSpacing: 0.8,
    },
    closeBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    closeText: {
      color: colors.textMuted,
      fontSize: fontSizes.xl,
      lineHeight: 20,
    },
    list: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing['2xl'],
    },
    row: {
      flexDirection: 'row',
      gap: spacing.md,
      padding: spacing.md,
      marginBottom: spacing.sm,
      borderRadius: radii.md,
      borderWidth: 1,
    },
    rowIcon: {
      width: 36,
      height: 36,
      borderRadius: 18,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    rowBody: {
      flex: 1,
      minWidth: 0,
    },
    rowTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: 3,
      gap: spacing.sm,
    },
    rowTitle: {
      flex: 1,
      fontSize: fontSizes.md,
      color: colors.textPrimary,
    },
    rowTime: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xxs,
      color: colors.textDim,
    },
    rowText: {
      fontSize: fontSizes.base,
      color: colors.textMuted,
      lineHeight: 17,
    },
    unreadDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.amber,
      marginTop: 4,
    },
  })
