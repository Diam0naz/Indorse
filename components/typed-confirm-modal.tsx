/**
 * components/typed-confirm-modal.tsx — deliberate confirmation for
 * irreversible admin actions.
 *
 * A plain "Are you sure?" is muscle memory; typing the exact instruction
 * name is not. Pass `phrase` and the confirm button stays disarmed until
 * the draft matches it exactly; pass `phrase={null}` for a one-tap confirm
 * (reversible operations — seat adds/removes, set initialization).
 */

import { useState } from 'react'
import { Modal, Pressable, Text, TextInput, View } from 'react-native'
import { useTheme } from '@/components/theme-provider'
import { SettingsButton } from '@/components/settings-ui'
import { createStyles, fontSizes, fontWeights, spacing, type Colors } from '@/constants/theme'
import { useT } from '@/lib/i18n'

export interface TypedConfirmModalProps {
  visible: boolean
  title: string
  description?: string
  /** Exact text the user must type to arm the confirm button; `null` = no phrase. */
  phrase: string | null
  confirmLabel: string
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function TypedConfirmModal({
  visible,
  title,
  description,
  phrase,
  confirmLabel,
  busy = false,
  onCancel,
  onConfirm,
}: TypedConfirmModalProps) {
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const t = useT()
  const [draft, setDraft] = useState('')

  // Both exits clear the draft, so every opening starts clean — a previous
  // phrase never arms a different confirmation. No effect needed: `visible`
  // only ever flips through these two paths.
  const cancel = () => {
    setDraft('')
    onCancel()
  }
  const confirm = () => {
    setDraft('')
    onConfirm()
  }

  const armed = phrase === null || draft.trim() === phrase

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={cancel}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTap} onPress={busy ? undefined : cancel} accessibilityLabel={title} />
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          {description ? <Text style={styles.description}>{description}</Text> : null}
          {phrase !== null ? (
            <View style={styles.phraseBox}>
              <Text style={styles.phraseHint}>{t('admin.typePhrase', { phrase })}</Text>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder={phrase}
                placeholderTextColor={colors.textDim}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel={t('admin.typePhrase', { phrase })}
                style={styles.input}
              />
            </View>
          ) : null}
          <View style={styles.actions}>
            <SettingsButton label={t('admin.cancel')} tone="secondary" onPress={cancel} disabled={busy} />
            <SettingsButton label={confirmLabel} tone="danger" onPress={confirm} disabled={!armed} busy={busy} />
          </View>
        </View>
      </View>
    </Modal>
  )
}

const makeStyles = (colors: Colors) =>
  createStyles({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(6,7,8,0.72)',
      justifyContent: 'center',
      paddingHorizontal: spacing.xl,
    },
    backdropTap: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    },
    card: {
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.borderMid,
      borderRadius: 20,
      padding: spacing.lg,
      gap: spacing.md,
    },
    title: {
      fontSize: fontSizes.lg,
      fontWeight: fontWeights.bold,
      color: colors.textPrimary,
    },
    description: {
      fontSize: fontSizes.sm,
      color: colors.textMuted,
      lineHeight: 19,
    },
    phraseBox: {
      gap: spacing.xs,
    },
    phraseHint: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xxs,
      color: colors.textDim,
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    input: {
      borderWidth: 1,
      borderColor: colors.borderMid,
      backgroundColor: colors.surface,
      borderRadius: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      fontFamily: 'monospace',
      fontSize: fontSizes.xs,
      color: colors.textPrimary,
    },
    actions: {
      flexDirection: 'row',
      gap: spacing.md,
    },
  })
