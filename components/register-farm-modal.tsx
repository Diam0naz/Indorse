/**
 * components/register-farm-modal.tsx — Onboarding form for the farm
 *
 * Collects name + GPS coordinates (with a "use my location" button that
 * fills them from one fix), validates with the shared validators and:
 *
 *   - wallet connected → sends `register_farm` through `useRegisterFarm`
 *     and records the PDA-backed farm in the local registry;
 *   - no wallet       → saves the farm on this device only (marked
 *     `source: 'local'` in FarmRegistryProvider) — the honest note under
 *     the form says so.
 *
 * In both paths the new farm becomes the current farm in the header pill.
 * Field errors render under each input; wallet/RPC failures render once
 * below the actions.
 *
 * Mounted only while open — its mutation hooks touch the wallet context, so
 * screens keep it behind a conditional render.
 */

import { useState } from 'react'
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFarmRegistry } from '@/components/farm-registry-provider'
import { useTheme } from '@/components/theme-provider'
import { createStyles, fontSizes, fontWeights, radii, spacing, type Colors } from '@/constants/theme'
import { useRegisterFarm } from '@/features/farm/useRegisterFarm'
import { validateRegisterFarm, type RegisterFarmValidationError } from '@/features/farm/types'
import { getCurrentCoords } from '@/features/scout/location'
import { useMobileWalletSetup } from '@/features/wallet/useMobileWalletSetup'
import { useT } from '@/lib/i18n'

interface RegisterFarmModalProps {
  onClose: () => void
  /** Called with the new farm PDA after a successful transaction. */
  onRegistered?: (farmAddress: string) => void
}

const EMPTY_ERRORS: RegisterFarmValidationError = {}

export function RegisterFarmModal({ onClose, onRegistered }: RegisterFarmModalProps) {
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const t = useT()
  const insets = useSafeAreaInsets()
  const register = useRegisterFarm()
  const { addFarm } = useFarmRegistry()
  const { walletState } = useMobileWalletSetup()
  const connected = walletState === 'connected'

  const [name, setName] = useState('')
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [errors, setErrors] = useState<RegisterFarmValidationError>(EMPTY_ERRORS)
  const [locating, setLocating] = useState(false)
  const [locError, setLocError] = useState<string | null>(null)

  const busy = register.isPending

  /** One permission+fix from the shared scout location helper. */
  async function useMyLocation() {
    if (busy || locating) return
    setLocating(true)
    setLocError(null)
    const fix = await getCurrentCoords()
    if (fix) {
      setLat(fix.lat.toFixed(6))
      setLng(fix.lng.toFixed(6))
      setErrors((prev) => ({ ...prev, lat: undefined, lng: undefined }))
    } else {
      setLocError(t('scout.register.locFailed'))
    }
    setLocating(false)
  }

  function submit() {
    if (busy) return
    const input = { name: name.trim(), lat: Number.parseFloat(lat), lng: Number.parseFloat(lng) }
    const found = validateRegisterFarm(input)
    setErrors(found ?? EMPTY_ERRORS)
    if (found) return

    if (!connected) {
      // No wallet — keep the farm on this device and feature it right away.
      addFarm({ ...input, source: 'local' })
      onClose()
      return
    }

    register.mutate(input, {
      onSuccess: (farmAddress) => {
        addFarm({ ...input, source: 'chain', address: farmAddress })
        onRegistered?.(farmAddress)
        onClose()
      },
    })
  }

  return (
    <Modal visible animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.root}>
        {/* Pad below the status bar (this Modal is statusBarTranslucent). */}
        <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
          <Text style={styles.title}>{t('scout.register.title')}</Text>
          <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={8} accessibilityLabel={t('scout.cam.close')}>
            <Text style={styles.closeText}>×</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.lead}>{t('scout.register.body')}</Text>

          <Text style={styles.label}>{t('scout.register.name')}</Text>
          <TextInput
            style={[styles.input, errors.name ? styles.inputError : null]}
            value={name}
            onChangeText={setName}
            placeholder={t('scout.register.phName')}
            placeholderTextColor={colors.textDim}
            editable={!busy}
            autoCapitalize="words"
            accessibilityLabel={t('scout.register.name')}
          />
          {errors.name ? <Text style={styles.fieldError}>{errors.name}</Text> : null}

          <View style={styles.coordRow}>
            <View style={styles.coordField}>
              <Text style={styles.label}>{t('scout.register.lat')}</Text>
              <TextInput
                style={[styles.input, errors.lat ? styles.inputError : null]}
                value={lat}
                onChangeText={setLat}
                placeholder={t('scout.register.phLat')}
                placeholderTextColor={colors.textDim}
                editable={!busy}
                keyboardType="decimal-pad"
                accessibilityLabel={t('scout.register.lat')}
              />
              {errors.lat ? <Text style={styles.fieldError}>{errors.lat}</Text> : null}
            </View>
            <View style={styles.coordField}>
              <Text style={styles.label}>{t('scout.register.lng')}</Text>
              <TextInput
                style={[styles.input, errors.lng ? styles.inputError : null]}
                value={lng}
                onChangeText={setLng}
                placeholder={t('scout.register.phLng')}
                placeholderTextColor={colors.textDim}
                editable={!busy}
                keyboardType="decimal-pad"
                accessibilityLabel={t('scout.register.lng')}
              />
              {errors.lng ? <Text style={styles.fieldError}>{errors.lng}</Text> : null}
            </View>
          </View>

          <Pressable
            style={[styles.locate, (busy || locating) && styles.locateBusy]}
            onPress={useMyLocation}
            disabled={busy || locating}
            accessibilityRole="button"
            accessibilityLabel={t('scout.register.useLocation')}
          >
            <Text style={styles.locateText}>
              {locating ? t('scout.register.locating') : t('scout.register.useLocation')}
            </Text>
          </Pressable>
          {locError ? <Text style={styles.fieldError}>{locError}</Text> : null}

          {!connected && (
            <View style={styles.localNote}>
              <Text style={styles.localNoteText}>{t('scout.register.localOnly')}</Text>
            </View>
          )}

          {register.isError && register.error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{register.error.message}</Text>
            </View>
          ) : null}

          <Pressable
            style={[styles.submit, busy && styles.submitBusy]}
            onPress={submit}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={t('scout.register.submit')}
          >
            <Text style={styles.submitText}>{busy ? t('scout.register.submitting') : t('scout.register.submit')}</Text>
          </Pressable>

          <Pressable style={styles.cancel} onPress={onClose} disabled={busy} accessibilityRole="button">
            <Text style={styles.cancelText}>{t('scout.register.cancel')}</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  )
}

/* ── Styles ────────────────────────────────────────────────────────────────── */

const makeStyles = (colors: Colors) =>
  createStyles({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.md,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    title: {
      fontSize: fontSizes.xl,
      fontWeight: fontWeights.bold,
      color: colors.textPrimary,
    },
    closeBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    closeText: {
      color: colors.textPrimary,
      fontSize: fontSizes.xl,
      lineHeight: 20,
    },
    body: {
      padding: spacing.lg,
      paddingBottom: spacing['3xl'],
    },
    lead: {
      fontSize: fontSizes.base,
      color: colors.textSecondary,
      lineHeight: 20,
      marginBottom: spacing.xl,
    },
    label: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xxs,
      color: colors.textDim,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      marginBottom: 6,
    },
    input: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md - 2,
      fontSize: fontSizes.base,
      color: colors.textPrimary,
    },
    inputError: {
      borderColor: colors.danger,
    },
    fieldError: {
      fontSize: fontSizes.xs,
      color: colors.dangerText,
      marginTop: 4,
      marginBottom: spacing.sm,
    },
    coordRow: {
      flexDirection: 'row',
      gap: spacing.md,
      marginTop: spacing.lg,
    },
    coordField: {
      flex: 1,
    },
    locate: {
      marginTop: spacing.md,
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      borderWidth: 1,
      borderColor: colors.sage,
      backgroundColor: `${colors.sage}1A`,
      borderRadius: radii.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
    },
    locateBusy: {
      opacity: 0.6,
    },
    locateText: {
      color: colors.sageLight,
      fontSize: fontSizes.sm,
      fontWeight: fontWeights.semibold,
    },
    localNote: {
      marginTop: spacing.lg,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.borderMid,
      borderRadius: radii.md,
      padding: spacing.md,
    },
    localNoteText: {
      fontSize: fontSizes.sm,
      color: colors.textMuted,
      lineHeight: 18,
    },
    errorBox: {
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.md,
      padding: spacing.md,
      marginTop: spacing.lg,
    },
    errorText: {
      fontSize: fontSizes.sm,
      color: colors.dangerText,
      lineHeight: 18,
    },
    submit: {
      marginTop: spacing.xl,
      backgroundColor: colors.primary,
      borderRadius: radii.lg,
      paddingVertical: spacing.lg,
      alignItems: 'center',
    },
    submitBusy: {
      opacity: 0.7,
    },
    submitText: {
      color: colors.surface,
      fontSize: fontSizes.md,
      fontWeight: fontWeights.bold,
    },
    cancel: {
      marginTop: spacing.md,
      paddingVertical: spacing.md,
      alignItems: 'center',
    },
    cancelText: {
      color: colors.textMuted,
      fontSize: fontSizes.md,
      fontWeight: fontWeights.semibold,
    },
  })
