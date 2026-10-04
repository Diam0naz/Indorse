/**
 * components/settings-ui.tsx — Shared chrome for the settings stack
 *
 * A page shell with a back header plus the row primitives every settings
 * screen reuses: labelled rows, switch rows, option rows that open a bottom
 * sheet, buttons and notes. All of it is built from the active palette.
 */

import { type ReactNode } from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, Switch, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Svg, { Path } from 'react-native-svg'
import { router } from 'expo-router'
import { Card, SectionLabel } from '@/components/screen-kit'
import { useTheme } from '@/components/theme-provider'
import { createStyles, fontSizes, fontWeights, radii, spacing, type Colors } from '@/constants/theme'
import { useT } from '@/lib/i18n'

/* ── Page shell ────────────────────────────────────────────────────────────── */

export function SettingsScreen({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: ReactNode
}) {
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const t = useT()

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
      <View style={styles.header}>
        <Pressable
          style={styles.backBtn}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t('settings.back')}
          hitSlop={8}
        >
          <Svg width={16} height={16} viewBox="0 0 16 16" fill="none">
            <Path
              d="M10 3 5 8l5 5"
              stroke={colors.textPrimary}
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.eyebrow}>{t('profile.settings')}</Text>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
    </SafeAreaView>
  )
}

/* ── Group ─────────────────────────────────────────────────────────────────── */

export function SettingsGroup({ label, children }: { label: string; children: ReactNode }) {
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  return (
    <View>
      <SectionLabel>{label}</SectionLabel>
      <Card style={styles.groupCard}>{children}</Card>
    </View>
  )
}

/* ── Row ───────────────────────────────────────────────────────────────────── */

export function SettingRow({
  title,
  description,
  children,
  onPress,
  disabled = false,
  last = false,
}: {
  title: string
  description?: string
  children?: ReactNode
  onPress?: () => void
  disabled?: boolean
  /** Renders without the separator — mark the final row of a group. */
  last?: boolean
}) {
  const { colors } = useTheme()
  const styles = makeStyles(colors)

  const body = (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, disabled && styles.rowDisabled]}>{title}</Text>
        {description ? <Text style={[styles.rowDesc, disabled && styles.rowDisabled]}>{description}</Text> : null}
      </View>
      {children ? <View style={styles.rowTrailing}>{children}</View> : null}
    </View>
  )

  if (onPress) {
    return (
      <View>
        <Pressable
          onPress={disabled ? undefined : onPress}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={title}
          style={({ pressed }) => [pressed && !disabled && styles.rowPressed]}
        >
          {body}
        </Pressable>
        {!last && <View style={styles.separator} />}
      </View>
    )
  }

  return (
    <View>
      {body}
      {!last && <View style={styles.separator} />}
    </View>
  )
}

/* ── Switch row ────────────────────────────────────────────────────────────── */

export function ToggleRow({
  title,
  description,
  value,
  onValueChange,
  disabled = false,
  last = false,
}: {
  title: string
  description?: string
  value: boolean
  onValueChange: (next: boolean) => void
  disabled?: boolean
  last?: boolean
}) {
  const { colors } = useTheme()
  return (
    <SettingRow title={title} description={description} disabled={disabled} last={last}>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityLabel={title}
        trackColor={{ false: colors.borderMid, true: colors.amber }}
        thumbColor={colors.surfaceAlt}
        ios_backgroundColor={colors.borderMid}
      />
    </SettingRow>
  )
}

/* ── Option row + sheet ────────────────────────────────────────────────────── */

export function OptionRow({
  title,
  description,
  valueLabel,
  onPress,
  disabled = false,
  selected = false,
  last = false,
}: {
  title: string
  description?: string
  valueLabel: string
  onPress: () => void
  disabled?: boolean
  /** Renders the amber check instead of the chevron (inline selection). */
  selected?: boolean
  last?: boolean
}) {
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  return (
    <SettingRow title={title} description={description} onPress={onPress} disabled={disabled} last={last}>
      <Text style={styles.optionValue} numberOfLines={1}>
        {valueLabel}
      </Text>
      {selected ? (
        <Svg width={14} height={14} viewBox="0 0 14 14" fill="none">
          <Path
            d="M2.5 7.5 5.5 10.5 11.5 4"
            stroke={colors.amber}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      ) : (
        <Svg width={14} height={14} viewBox="0 0 14 14" fill="none">
          <Path
            d="M5 3l4 4-4 4"
            stroke={colors.textMuted}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      )}
    </SettingRow>
  )
}

export interface SheetOption {
  value: string
  label: string
  hint?: string
}

export function OptionSheet({
  visible,
  title,
  options,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean
  title: string
  options: SheetOption[]
  selected: string
  onSelect: (value: string) => void
  onClose: () => void
}) {
  const { colors } = useTheme()
  const styles = makeStyles(colors)

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <Pressable style={styles.sheetBackdropTap} onPress={onClose} accessibilityLabel={title} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>{title}</Text>
          <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
            {options.map((option, index) => {
              const active = option.value === selected
              return (
                <Pressable
                  key={option.value}
                  onPress={() => {
                    onSelect(option.value)
                    onClose()
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  style={[styles.sheetRow, index < options.length - 1 && styles.sheetRowBorder]}
                >
                  <View style={styles.sheetRowText}>
                    <Text style={[styles.sheetRowLabel, active && styles.sheetRowLabelActive]}>{option.label}</Text>
                    {option.hint ? <Text style={styles.sheetRowHint}>{option.hint}</Text> : null}
                  </View>
                  {active && (
                    <Svg width={16} height={16} viewBox="0 0 16 16" fill="none">
                      <Path
                        d="M3.5 8.5 6.5 11.5 12.5 5"
                        stroke={colors.amber}
                        strokeWidth={1.8}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </Svg>
                  )}
                </Pressable>
              )
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

/* ── Buttons ───────────────────────────────────────────────────────────────── */

export function SettingsButton({
  label,
  onPress,
  tone = 'primary',
  disabled = false,
  busy = false,
}: {
  label: string
  onPress: () => void
  tone?: 'primary' | 'secondary' | 'danger'
  disabled?: boolean
  busy?: boolean
}) {
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  return (
    <Pressable
      onPress={disabled || busy ? undefined : onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.btn,
        tone === 'primary' && styles.btnPrimary,
        tone === 'secondary' && styles.btnSecondary,
        tone === 'danger' && styles.btnDanger,
        (disabled || busy) && styles.btnDisabled,
        pressed && !disabled && styles.btnPressed,
      ]}
    >
      <View style={styles.btnContent}>
        {busy ? <ActivityIndicator size="small" color={colors.textMuted} /> : null}
        <Text
          style={[
            styles.btnLabel,
            tone === 'primary' && styles.btnLabelPrimary,
            tone === 'secondary' && styles.btnLabelSecondary,
            tone === 'danger' && styles.btnLabelDanger,
            (disabled || busy) && styles.btnLabelDisabled,
          ]}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  )
}

/* ── Note ──────────────────────────────────────────────────────────────────── */

export function SettingsNote({ children }: { children: ReactNode }) {
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  return <Text style={styles.note}>{children}</Text>
}

/* ── Styles ────────────────────────────────────────────────────────────────── */

const makeStyles = (colors: Colors) =>
  createStyles({
    safe: {
      flex: 1,
      backgroundColor: colors.surface,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.lg,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    backBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerText: {
      flex: 1,
      minWidth: 0,
    },
    eyebrow: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xxs,
      color: colors.textDim,
      letterSpacing: 1.5,
      textTransform: 'uppercase',
    },
    title: {
      fontSize: fontSizes['2xl'],
      fontWeight: fontWeights.bold,
      color: colors.textPrimary,
      marginTop: 2,
    },
    subtitle: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xs,
      color: colors.textMuted,
      marginTop: 3,
    },
    content: {
      padding: spacing.lg,
      paddingBottom: spacing['2xl'],
      gap: spacing.xl,
    },
    groupCard: {
      padding: 0,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.lg,
    },
    rowPressed: {
      backgroundColor: colors.surface,
    },
    rowText: {
      flex: 1,
      minWidth: 0,
      gap: 3,
    },
    rowTitle: {
      fontSize: fontSizes.md,
      fontWeight: fontWeights.medium,
      color: colors.textPrimary,
    },
    rowDesc: {
      fontSize: fontSizes.sm,
      color: colors.textMuted,
      lineHeight: 17,
    },
    rowDisabled: {
      opacity: 0.45,
    },
    rowTrailing: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      maxWidth: '55%',
    },
    separator: {
      height: 1,
      backgroundColor: colors.border,
      marginLeft: spacing.lg,
    },
    optionValue: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xs,
      color: colors.textSecondary,
      letterSpacing: 0.6,
      flexShrink: 1,
      textAlign: 'right',
    },

    // Option sheet
    sheetBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(6,7,8,0.7)',
      justifyContent: 'flex-end',
    },
    sheetBackdropTap: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    },
    sheet: {
      backgroundColor: colors.surfaceAlt,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      borderWidth: 1,
      borderColor: colors.border,
      paddingTop: spacing.sm,
      paddingBottom: spacing['2xl'],
      paddingHorizontal: spacing.lg,
      maxHeight: '70%',
    },
    sheetHandle: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.borderMid,
      alignSelf: 'center',
      marginBottom: spacing.md,
    },
    sheetTitle: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xs,
      color: colors.textDim,
      letterSpacing: 1.5,
      textTransform: 'uppercase',
      marginBottom: spacing.sm,
      paddingHorizontal: spacing.xs,
    },
    sheetRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.xs,
    },
    sheetRowBorder: {
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    sheetRowText: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    sheetRowLabel: {
      fontSize: fontSizes.md,
      color: colors.textSecondary,
    },
    sheetRowLabelActive: {
      color: colors.textPrimary,
      fontWeight: fontWeights.semibold,
    },
    sheetRowHint: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xxs,
      color: colors.textDim,
    },

    // Buttons
    btn: {
      borderRadius: radii.md,
      borderWidth: 1,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    btnContent: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
    },
    btnPrimary: {
      backgroundColor: colors.amber,
      borderColor: colors.amber,
    },
    btnSecondary: {
      backgroundColor: colors.surfaceAlt,
      borderColor: colors.borderMid,
    },
    btnDanger: {
      backgroundColor: `${colors.danger}14`,
      borderColor: `${colors.danger}66`,
    },
    btnDisabled: {
      opacity: 0.5,
    },
    btnPressed: {
      opacity: 0.8,
    },
    btnLabel: {
      fontSize: fontSizes.base,
      fontWeight: fontWeights.semibold,
      color: colors.textPrimary,
      textAlign: 'center',
    },
    btnLabelPrimary: {
      color: colors.surface,
    },
    btnLabelSecondary: {
      color: colors.textSecondary,
    },
    btnLabelDanger: {
      color: colors.dangerText,
    },
    btnLabelDisabled: {
      color: colors.textMuted,
    },
    note: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xxs,
      color: colors.textDim,
      lineHeight: 15,
      paddingHorizontal: spacing.xs,
    },
  })
