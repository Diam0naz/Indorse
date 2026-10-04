/**
 * components/farm-switcher-sheet.tsx — Pick the farm the app features
 *
 * Opened from the header pill: lists every farm in the local registry
 * (on-chain farms badged with their PDA, device-only farms marked "local")
 * as cards. Tapping one makes it the current farm — the shared header pill
 * updates on every screen through FarmRegistryProvider.
 *
 * The footer's "Add farm" hands off to the register modal (the caller owns
 * it, so the sheet only reports the intent) — guests can save a farm on
 * this device, wallets register one on-chain.
 */

import { Modal, Pressable, ScrollView, Text, View } from 'react-native'
import { EmptyState } from '@/components/screen-kit'
import { useFarmRegistry, type FarmEntry } from '@/components/farm-registry-provider'
import { useTheme } from '@/components/theme-provider'
import { createStyles, fontSizes, fontWeights, radii, spacing, type Colors } from '@/constants/theme'
import { shortenAddress } from '@/lib/format'
import { useT } from '@/lib/i18n'
import * as Haptics from 'expo-haptics'

interface FarmSwitcherSheetProps {
  visible: boolean
  onClose: () => void
  /** The sheet's "Add farm" button — caller opens the register modal. */
  onAddFarm: () => void
}

export function FarmSwitcherSheet({ visible, onClose, onAddFarm }: FarmSwitcherSheetProps) {
  const { farms, currentId, setCurrent } = useFarmRegistry()
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const t = useT()

  function pick(entry: FarmEntry) {
    Haptics.selectionAsync()
    setCurrent(entry.id)
    onClose()
  }

  function addFarm() {
    Haptics.selectionAsync()
    onClose()
    onAddFarm()
  }

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTap} onPress={onClose} accessibilityLabel={t('scout.cam.close')} />
        <View style={styles.sheet}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title}>{t('farms.title')}</Text>
              <Text style={styles.count}>{t('farms.count', { n: farms.length })}</Text>
            </View>
            <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={8} accessibilityLabel={t('scout.cam.close')}>
              <Text style={styles.closeText}>×</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
            {farms.length === 0 ? (
              <EmptyState title={t('farms.empty')} message={t('farms.emptyBody')} />
            ) : (
              farms.map((entry) => {
                const selected = entry.id === currentId
                return (
                  <Pressable
                    key={entry.id}
                    style={[styles.card, selected && styles.cardSelected]}
                    onPress={() => pick(entry)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${entry.name}, ${selected ? t('farms.current') : ''}`}
                  >
                    <View style={styles.cardMain}>
                      <Text style={styles.cardName} numberOfLines={1}>
                        {entry.name}
                      </Text>
                      <Text style={styles.cardMeta} numberOfLines={1}>
                        {entry.lat.toFixed(4)}, {entry.lng.toFixed(4)}
                        {entry.address ? ` · ${shortenAddress(entry.address, 4)}` : ''}
                      </Text>
                      <View style={styles.chipRow}>
                        <View style={[styles.chip, entry.source === 'chain' ? styles.chipChain : styles.chipLocal]}>
                          <Text
                            style={[
                              styles.chipText,
                              entry.source === 'chain' ? styles.chipTextChain : styles.chipTextLocal,
                            ]}
                          >
                            {entry.source === 'chain' ? t('header.onChain') : t('header.local')}
                          </Text>
                        </View>
                        {entry.reportCount !== undefined && (
                          <Text style={styles.cardReports}>{t('header.reportsN', { n: entry.reportCount })}</Text>
                        )}
                      </View>
                    </View>
                    {selected && <Text style={styles.check}>✓</Text>}
                  </Pressable>
                )
              })
            )}
          </ScrollView>

          <Pressable style={styles.addBtn} onPress={addFarm} accessibilityRole="button">
            <Text style={styles.addText}>{t('farms.add')}</Text>
          </Pressable>
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
      backgroundColor: 'rgba(0,0,0,0.55)',
      justifyContent: 'flex-end',
    },
    backdropTap: {
      flex: 1,
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radii.xl,
      borderTopRightRadius: radii.xl,
      borderTopWidth: 1,
      borderColor: colors.border,
      paddingBottom: spacing.xl,
      maxHeight: '80%',
    },
    handle: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.borderMid,
      marginTop: spacing.sm,
      marginBottom: spacing.sm,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerText: {
      gap: 2,
    },
    title: {
      fontSize: fontSizes.lg,
      fontWeight: fontWeights.bold,
      color: colors.textPrimary,
    },
    count: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xxs,
      color: colors.textDim,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
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
      color: colors.textPrimary,
      fontSize: fontSizes.lg,
      lineHeight: 18,
    },
    list: {
      padding: spacing.lg,
      gap: spacing.md,
    },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: colors.surfaceAlt,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
    },
    cardSelected: {
      borderColor: colors.amber,
      backgroundColor: `${colors.amber}14`,
    },
    cardMain: {
      flex: 1,
      minWidth: 0,
      gap: 3,
    },
    cardName: {
      fontSize: fontSizes.md,
      fontWeight: fontWeights.semibold,
      color: colors.textPrimary,
    },
    cardMeta: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xs,
      color: colors.textMuted,
    },
    chipRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: 3,
    },
    chip: {
      borderRadius: radii.sm,
      borderWidth: 1,
      paddingHorizontal: spacing.sm - 2,
      paddingVertical: 2,
    },
    chipChain: {
      borderColor: `${colors.sage}80`,
      backgroundColor: `${colors.sage}1F`,
    },
    chipLocal: {
      borderColor: colors.borderMid,
      backgroundColor: colors.surface,
    },
    chipText: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xxs,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    chipTextChain: {
      color: colors.sageLight,
    },
    chipTextLocal: {
      color: colors.textDim,
    },
    cardReports: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xxs,
      color: colors.textDim,
    },
    check: {
      fontSize: fontSizes.xl,
      fontWeight: fontWeights.bold,
      color: colors.amber,
    },
    addBtn: {
      marginHorizontal: spacing.lg,
      marginTop: spacing.sm,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.amber,
      paddingVertical: spacing.md,
      alignItems: 'center',
    },
    addText: {
      color: colors.amber,
      fontSize: fontSizes.md,
      fontWeight: fontWeights.semibold,
    },
  })
