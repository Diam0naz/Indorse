/**
 * components/log-harvest-modal.tsx — Record what came off the field
 *
 * The prerequisite step for escrow: a farm with no harvest batches has
 * nothing to lock funds against, so the Provenance screen offers this form
 * first. Collects crop, quantity and the harvest location (with the same
 * "use my location" helper as the register form), then runs
 * `submit_harvest_batch` — the new batch takes the farm's current index.
 *
 * There is no photo in this flow, so the on-chain `photo_hash` is the real
 * SHA-256 of the batch URI (`indorse://harvest/<ts>`) — a digest of the
 * record itself, never a seeded value. A guest sees the honest
 * "connect a wallet" note; batches live on-chain only.
 */

import { useState } from 'react'
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@/components/theme-provider'
import { createStyles, fontSizes, fontWeights, radii, spacing, type Colors } from '@/constants/theme'
import { useSubmitHarvest } from '@/features/harvest/useSubmitHarvest'
import { validateHarvestBatch, type HarvestBatchValidationError } from '@/features/harvest/types'
import { getCurrentCoords } from '@/features/scout/location'
import { photoHash } from '@/features/scout/photo'
import { useMobileWalletSetup } from '@/features/wallet/useMobileWalletSetup'
import { useT } from '@/lib/i18n'

const EMPTY_ERRORS: HarvestBatchValidationError = {}

interface LogHarvestModalProps {
  farmAddress: string
  /** The farm's current batch count — the new batch takes this index. */
  batchCount: number
  onClose: () => void
}

export function LogHarvestModal({ farmAddress, batchCount, onClose }: LogHarvestModalProps) {
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const t = useT()
  const insets = useSafeAreaInsets()
  const submitHarvest = useSubmitHarvest()
  const { walletState } = useMobileWalletSetup()
  const connected = walletState === 'connected'

  const [crop, setCrop] = useState('')
  const [quantity, setQuantity] = useState('')
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<HarvestBatchValidationError>(EMPTY_ERRORS)
  const [locating, setLocating] = useState(false)
  const [locError, setLocError] = useState<string | null>(null)
  const [hashing, setHashing] = useState(false)

  const busy = submitHarvest.isPending || hashing
  const disabled = busy || !connected

  /** One permission+fix from the shared scout location helper. */
  async function useMyLocation() {
    if (disabled || locating) return
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

  async function submit() {
    if (disabled) return
    const uri = `indorse://harvest/${Date.now()}`
    const input = {
      farmAddress,
      batchCount,
      photoHash: new Array<number>(32).fill(0),
      uri,
      lat: Number.parseFloat(lat),
      lng: Number.parseFloat(lng),
      crop: crop.trim(),
      quantityKg: Number.parseFloat(quantity),
      notes: notes.trim(),
    }
    const found = validateHarvestBatch(input)
    setErrors(found ?? EMPTY_ERRORS)
    if (found) return

    // Real digest of the record URI — the batch has no photo to hash.
    setHashing(true)
    try {
      const digest = await photoHash(uri)
      submitHarvest.mutate({ ...input, photoHash: digest }, { onSuccess: onClose })
    } finally {
      setHashing(false)
    }
  }

  return (
    <Modal visible animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.root}>
        {/* Pad below the status bar (this Modal is statusBarTranslucent). */}
        <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
          <Text style={styles.title}>{t('prov.harvest.title')}</Text>
          <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={8} accessibilityLabel={t('scout.cam.close')}>
            <Text style={styles.closeText}>×</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.lead}>{t('prov.harvest.lead')}</Text>

          <Text style={styles.label}>{t('prov.harvest.crop')}</Text>
          <TextInput
            style={[styles.input, errors.crop ? styles.inputError : null]}
            value={crop}
            onChangeText={setCrop}
            placeholder={t('wx.policyForm.phCrop')}
            placeholderTextColor={colors.textDim}
            editable={!disabled}
            autoCapitalize="words"
            accessibilityLabel={t('prov.harvest.crop')}
          />
          {errors.crop ? <Text style={styles.fieldError}>{errors.crop}</Text> : null}

          <Text style={styles.label}>{t('prov.harvest.qty')}</Text>
          <TextInput
            style={[styles.input, errors.quantityKg ? styles.inputError : null]}
            value={quantity}
            onChangeText={setQuantity}
            placeholder="640"
            placeholderTextColor={colors.textDim}
            editable={!disabled}
            keyboardType="decimal-pad"
            accessibilityLabel={t('prov.harvest.qty')}
          />
          {errors.quantityKg ? <Text style={styles.fieldError}>{errors.quantityKg}</Text> : null}

          <View style={styles.coordRow}>
            <View style={styles.coordField}>
              <Text style={styles.label}>{t('scout.register.lat')}</Text>
              <TextInput
                style={[styles.input, errors.lat ? styles.inputError : null]}
                value={lat}
                onChangeText={setLat}
                placeholder={t('scout.register.phLat')}
                placeholderTextColor={colors.textDim}
                editable={!disabled}
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
                editable={!disabled}
                keyboardType="decimal-pad"
                accessibilityLabel={t('scout.register.lng')}
              />
              {errors.lng ? <Text style={styles.fieldError}>{errors.lng}</Text> : null}
            </View>
          </View>

          <Pressable
            style={[styles.locate, (disabled || locating) && styles.locateBusy]}
            onPress={useMyLocation}
            disabled={disabled || locating}
            accessibilityRole="button"
            accessibilityLabel={t('scout.register.useLocation')}
          >
            <Text style={styles.locateText}>
              {locating ? t('scout.register.locating') : t('scout.register.useLocation')}
            </Text>
          </Pressable>
          {locError ? <Text style={styles.fieldError}>{locError}</Text> : null}

          <Text style={styles.label}>{t('prov.harvest.notes')}</Text>
          <TextInput
            style={[styles.input, errors.notes ? styles.inputError : null]}
            value={notes}
            onChangeText={setNotes}
            placeholder={t('prov.harvest.notesPh')}
            placeholderTextColor={colors.textDim}
            editable={!disabled}
            multiline
            accessibilityLabel={t('prov.harvest.notes')}
          />
          {errors.notes ? <Text style={styles.fieldError}>{errors.notes}</Text> : null}

          {!connected && (
            <View style={styles.note}>
              <Text style={styles.noteText}>{t('prov.harvest.walletNeeded')}</Text>
            </View>
          )}

          {submitHarvest.isError && submitHarvest.error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{submitHarvest.error.message}</Text>
            </View>
          ) : null}

          <Pressable
            style={[styles.submit, disabled && styles.submitBusy]}
            onPress={submit}
            disabled={disabled}
            testID="harvest-submit"
            accessibilityRole="button"
            accessibilityLabel={t('prov.harvest.submit')}
          >
            <Text style={styles.submitText}>{busy ? t('prov.harvest.submitting') : t('prov.harvest.submit')}</Text>
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
    note: {
      marginTop: spacing.lg,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.borderMid,
      borderRadius: radii.md,
      padding: spacing.md,
    },
    noteText: {
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
