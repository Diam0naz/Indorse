/**
 * app/setup.tsx — Profile-driven setup wizard
 *
 * Six steps — profile → wallet → farm → access → lock → done — reached from
 * the "Complete your setup" banner on the Profile tab, and re-enterable any
 * time. This is deliberately NOT the first-run intro: `app/onboarding.tsx`
 * stays untouched as the splash + 3-slide welcome for brand-new installs.
 *
 * Mechanics follow the approved flow: "Step X of {total}" eyebrow, progress
 * dots, a Back/Next footer with "(optional)" markers, and the final CTA swap
 * to "Start scouting →". Steps 2–5 mount only while active, so step 1 stands
 * on its own (its test needs no Auth/Query/wallet providers), and each of
 * those steps offers "Skip for now" — persisted through ProfileProvider so
 * the Profile banner counts a skipped step as handled.
 *
 * Step 1's photo comes from expo-image-picker (camera + library, square
 * crop) and is copied out of the cache into documentDirectory/profile/ so
 * the avatar survives cache cleanup; it renders with a plain RN Image.
 * The farm step reuses RegisterFarmModal + useFarmQuery, the lock step
 * reads useAuth (AuthGate owns the actual passcode flow).
 */

import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Svg, { Path } from 'react-native-svg'
import * as Haptics from 'expo-haptics'
import { useCameraPermissions } from 'expo-camera'
import * as ImagePicker from 'expo-image-picker'
import type { ImagePickerResult } from 'expo-image-picker'
import { router } from 'expo-router'
import { FontAwesome5 } from '@expo/vector-icons'
import { IndorseMarkSmall } from '@/components/IndorseMark'
import { useAuth } from '@/components/auth-provider'
import { useProfile } from '@/components/profile-provider'
import { RegisterFarmModal } from '@/components/register-farm-modal'
import { OptionSheet, type SheetOption } from '@/components/settings-ui'
import { useTheme } from '@/components/theme-provider'
import { useFarmQuery } from '@/features/farm/useFarmQuery'
import {
  initialsOf,
  setupProgress,
  validateProfile,
  type DeferredFlags,
  type ProfileValidationError,
  type SetupSignalKey,
} from '@/features/profile/types'
import { useSetupSignals } from '@/features/profile/useSetupSignals'
import { getLocationPermission, requestLocationPermission } from '@/features/scout/location'
import { useMobileWalletSetup } from '@/features/wallet'
import { shortenAddress } from '@/lib/format'
import { useT, type MessageKey } from '@/lib/i18n'
import { createStyles, fontSizes, fontWeights, radii, spacing, type Colors } from '@/constants/theme'

const TOTAL_STEPS = 6

/** Index 0–5 ↔ wizard step 1–6. Step 3 reuses the scout register copy. */
const STEP_TITLES: MessageKey[] = [
  'setup.s1.title',
  'setup.s2.title',
  'scout.register.title',
  'setup.s4.title',
  'setup.s5.title',
  'setup.s6.title',
]
const STEP_BODIES: MessageKey[] = [
  'setup.s1.body',
  'setup.s2.body',
  'scout.register.body',
  'setup.s4.body',
  'setup.s5.body',
  'setup.s6.body',
]

/** Wizard step → the deferral flag its "Skip for now" persists. */
const STEP_DEFERRALS: Record<number, keyof DeferredFlags> = {
  2: 'wallet',
  3: 'farm',
  4: 'access',
  5: 'lock',
}

const CHECK_LABELS: Record<SetupSignalKey, MessageKey> = {
  profile: 'setup.check.profile',
  wallet: 'setup.check.wallet',
  farm: 'setup.check.farm',
  access: 'setup.check.access',
}

/**
 * Copy the picked photo out of the (purgeable) cache into
 * documentDirectory/profile/avatar.<ext>. Any failure — no document dir, a
 * stale source URI, a native miss — falls back to the original cache URI so
 * the avatar still renders this session.
 */
async function persistPhoto(uri: string): Promise<string> {
  try {
    const FS = await import('expo-file-system/legacy')
    if (!FS.documentDirectory) return uri
    const dir = `${FS.documentDirectory}profile/`
    try {
      await FS.makeDirectoryAsync(dir, { intermediates: true })
    } catch {
      // Already there — makeDirectoryAsync rejects without `intermediates` only.
    }
    const dot = uri.lastIndexOf('.')
    const ext = dot > 0 && uri.length - dot <= 5 ? uri.slice(dot) : '.jpg'
    const dest = `${dir}avatar${ext}`
    await FS.deleteAsync(dest, { idempotent: true }).catch(() => undefined)
    await FS.copyAsync({ from: uri, to: dest })
    return dest
  } catch {
    return uri
  }
}

export default function SetupScreen() {
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const t = useT()
  const { profile, saveProfile, deferStep } = useProfile()

  const [step, setStep] = useState(1)
  // The stored profile is read at mount: ProfileProvider has long settled by
  // the time the banner opens this wizard, so seeding here (rather than an
  // effect) covers re-entry without a cascading render.
  const [name, setName] = useState(() => profile?.name ?? '')
  const [bio, setBio] = useState(() => profile?.bio ?? '')
  const [photoUri, setPhotoUri] = useState<string | null>(() => profile?.photoUri ?? null)
  const [errors, setErrors] = useState<ProfileValidationError>({})

  const updateName = (value: string) => {
    setName(value)
    if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }))
  }
  const updateBio = (value: string) => {
    setBio(value)
    if (errors.bio) setErrors((prev) => ({ ...prev, bio: undefined }))
  }

  function next() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    if (step === 1) {
      const found = validateProfile({ name, bio, photoUri })
      setErrors(found ?? {})
      if (found) return
      saveProfile({ name, bio, photoUri })
    }
    setStep((s) => Math.min(s + 1, TOTAL_STEPS))
  }

  function back() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setStep((s) => Math.max(s - 1, 1))
  }

  function skip() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    const flag = STEP_DEFERRALS[step]
    if (flag) deferStep(flag)
    setStep((s) => Math.min(s + 1, TOTAL_STEPS))
  }

  function finish() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    router.replace('/(tabs)')
  }

  const isFinal = step === TOTAL_STEPS
  const ctaLabel = isFinal ? t('setup.start') : t('setup.next')

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.topBar}>
        <View style={styles.brandTile}>
          <IndorseMarkSmall size={16} />
        </View>
        <Text style={styles.eyebrow}>{t('setup.step', { n: step, total: TOTAL_STEPS })}</Text>
      </View>

      <View style={styles.dotsRow}>
        {Array.from({ length: TOTAL_STEPS }, (_, i) => (
          <View key={i} style={[styles.dot, i + 1 === step ? styles.dotActive : styles.dotInactive]} />
        ))}
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>{t(STEP_TITLES[step - 1])}</Text>
          <Text style={styles.body}>{t(STEP_BODIES[step - 1])}</Text>

          {step === 1 && (
            <ProfileStep
              name={name}
              bio={bio}
              photoUri={photoUri}
              errors={errors}
              onName={updateName}
              onBio={updateBio}
              onPhotoUri={setPhotoUri}
            />
          )}
          {step === 2 && <WalletStep />}
          {step === 3 && <FarmStep />}
          {step === 4 && <AccessStep />}
          {step === 5 && <LockStep />}
          {step === 6 && <DoneStep />}
        </ScrollView>

        <View style={styles.footer}>
          {step > 1 && (
            <View style={styles.footerNav}>
              <Pressable
                onPress={back}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('setup.back')}
                style={styles.navBtn}
              >
                <Text style={styles.navText}>{t('setup.back')}</Text>
              </Pressable>
              {!isFinal && (
                <Pressable
                  onPress={skip}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={t('setup.skip')}
                  style={styles.navBtn}
                >
                  <Text style={styles.navText}>{t('setup.skip')}</Text>
                </Pressable>
              )}
            </View>
          )}

          <Pressable
            style={styles.cta}
            onPress={isFinal ? finish : next}
            accessibilityRole="button"
            accessibilityLabel={ctaLabel}
          >
            <Text style={styles.ctaText}>{ctaLabel}</Text>
            <Svg width={14} height={14} viewBox="0 0 14 14" fill="none">
              <Path
                d="M3 7h8M8 4l3 3-3 3"
                stroke={colors.surface}
                strokeWidth={1.6}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

/* ── Step 1 — profile ────────────────────────────────────────────────────── */

function ProfileStep({
  name,
  bio,
  photoUri,
  errors,
  onName,
  onBio,
  onPhotoUri,
}: {
  name: string
  bio: string
  photoUri: string | null
  errors: ProfileValidationError
  onName: (value: string) => void
  onBio: (value: string) => void
  onPhotoUri: (uri: string | null) => void
}) {
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const t = useT()
  const [sheetOpen, setSheetOpen] = useState(false)

  async function applyResult(result: ImagePickerResult) {
    if (result.canceled) return
    const uri = result.assets?.[0]?.uri
    if (!uri) return
    onPhotoUri(await persistPhoto(uri))
  }

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync().catch(() => null)
    if (!perm?.granted) return
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    })
    await applyResult(result)
  }

  async function choosePhoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync().catch(() => null)
    if (!perm?.granted) return
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    })
    await applyResult(result)
  }

  const options: SheetOption[] = [
    { value: 'camera', label: t('setup.s1.takePhoto') },
    { value: 'library', label: t('setup.s1.choosePhoto') },
    ...(photoUri ? [{ value: 'remove', label: t('setup.s1.removePhoto') }] : []),
  ]

  function selectOption(value: string) {
    if (value === 'camera') void takePhoto()
    else if (value === 'library') void choosePhoto()
    else onPhotoUri(null)
  }

  return (
    <View style={styles.step}>
      <View style={styles.photoRow}>
        <Pressable
          onPress={() => setSheetOpen(true)}
          style={styles.photoWrap}
          accessibilityRole="button"
          accessibilityLabel={t('setup.s1.photoTitle')}
          testID="setup-photo"
        >
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.photoImg} testID="setup-photo-img" />
          ) : (
            <Text style={styles.photoInitials}>{initialsOf(name) || '?'}</Text>
          )}
          <View style={styles.photoBadge}>
            <FontAwesome5 name="camera" size={11} color={colors.surface} />
          </View>
        </Pressable>
        <View style={styles.photoCopy}>
          <Text style={styles.photoTitle}>{t('setup.s1.photoTitle')}</Text>
          <Text style={styles.photoHint}>{t('setup.s1.photoHint')}</Text>
        </View>
      </View>

      <OptionSheet
        visible={sheetOpen}
        title={t('setup.s1.photoTitle')}
        options={options}
        selected=""
        onSelect={selectOption}
        onClose={() => setSheetOpen(false)}
      />

      <Text style={styles.label}>{t('setup.s1.name')}</Text>
      <TextInput
        style={[styles.input, errors.name && styles.inputError]}
        value={name}
        onChangeText={onName}
        placeholder={t('setup.s1.namePh')}
        placeholderTextColor={colors.textDim}
        autoCapitalize="words"
        accessibilityLabel={t('setup.s1.name')}
      />
      {errors.name ? (
        <Text style={styles.fieldError} testID="setup-name-error">
          {errors.name}
        </Text>
      ) : null}

      <Text style={styles.label}>{`${t('setup.s1.bio')} ${t('setup.optional')}`}</Text>
      <TextInput
        style={[styles.input, styles.inputBio, errors.bio && styles.inputError]}
        value={bio}
        onChangeText={onBio}
        placeholder={t('setup.s1.bioPh')}
        placeholderTextColor={colors.textDim}
        multiline
        accessibilityLabel={t('setup.s1.bio')}
      />
      {errors.bio ? <Text style={styles.fieldError}>{errors.bio}</Text> : null}
    </View>
  )
}

/* ── Step 2 — wallet ─────────────────────────────────────────────────────── */

function WalletStep() {
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const t = useT()
  const { address, walletState, toggleConnection, error } = useMobileWalletSetup()
  const connected = walletState === 'connected'
  const busy = walletState === 'connecting'

  return (
    <View style={styles.step}>
      <View style={[styles.statusCard, connected && styles.statusCardDone]}>
        <View style={[styles.statusIcon, connected && styles.statusIconDone]}>
          <FontAwesome5
            name={connected ? 'check' : 'wallet'}
            size={15}
            color={connected ? colors.surface : colors.amber}
          />
        </View>
        <View style={styles.statusText}>
          <Text style={styles.statusTitle}>{connected ? t('wallet.connected') : t('profile.notConnected')}</Text>
          {connected && address ? <Text style={styles.statusSub}>{shortenAddress(address, 4)}</Text> : null}
        </View>
      </View>

      <Pressable
        style={[styles.primaryBtn, connected && styles.primaryBtnGhost]}
        onPress={() => void toggleConnection()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={connected ? t('wallet.disconnect') : t('wallet.connect')}
      >
        {busy ? (
          <ActivityIndicator size="small" color={colors.surface} />
        ) : (
          <Text style={[styles.primaryBtnText, connected && styles.primaryBtnGhostText]}>
            {connected ? t('wallet.disconnect') : t('wallet.connect')}
          </Text>
        )}
      </Pressable>

      {!connected ? <Text style={styles.hint}>{t('setup.s2.hint')}</Text> : null}
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  )
}

/* ── Step 3 — farm ───────────────────────────────────────────────────────── */

function FarmStep() {
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const t = useT()
  const { farm, farmAddress, state, retry } = useFarmQuery()
  const [registerOpen, setRegisterOpen] = useState(false)

  if (farm) {
    return (
      <View style={styles.step}>
        <View style={[styles.statusCard, styles.statusCardDone]}>
          <View style={[styles.statusIcon, styles.statusIconDone]}>
            <FontAwesome5 name="check" size={15} color={colors.surface} />
          </View>
          <View style={styles.statusText}>
            <Text style={styles.statusTitle}>{t('setup.s3.done')}</Text>
            <Text style={styles.statusSub}>{farm.name}</Text>
            {farmAddress ? <Text style={styles.statusSub}>{shortenAddress(farmAddress, 4)}</Text> : null}
          </View>
        </View>
        <Text style={styles.hint}>{t('setup.s3.hint')}</Text>
      </View>
    )
  }

  return (
    <View style={styles.step}>
      {state === 'loading' ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={colors.textMuted} />
        </View>
      ) : null}

      <Pressable
        style={styles.primaryBtn}
        onPress={() => setRegisterOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={t('scout.register.action')}
      >
        <Text style={styles.primaryBtnText}>{t('scout.register.action')}</Text>
      </Pressable>
      <Text style={styles.hint}>{t('setup.s3.hint')}</Text>

      {registerOpen ? (
        <RegisterFarmModal onClose={() => setRegisterOpen(false)} onRegistered={() => void retry()} />
      ) : null}
    </View>
  )
}

/* ── Step 4 — camera + location ──────────────────────────────────────────── */

function AccessStep() {
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const t = useT()
  const [cameraPermission, requestCamera] = useCameraPermissions()
  const [locationGranted, setLocationGranted] = useState<boolean | null>(null)

  useEffect(() => {
    let live = true
    void getLocationPermission().then((granted) => {
      if (live) setLocationGranted(granted)
    })
    return () => {
      live = false
    }
  }, [])

  async function allowLocation() {
    setLocationGranted(await requestLocationPermission())
  }

  return (
    <View style={styles.step}>
      <PermissionRow
        icon="camera"
        label={t('setup.s4.camera')}
        granted={cameraPermission?.granted ?? false}
        onAllow={() => void requestCamera()}
      />
      <PermissionRow
        icon="map-marker-alt"
        label={t('setup.s4.location')}
        granted={locationGranted === true}
        loading={locationGranted === null}
        onAllow={() => void allowLocation()}
      />
      <Text style={styles.hint}>{t('setup.s4.hint')}</Text>
    </View>
  )
}

function PermissionRow({
  icon,
  label,
  granted,
  loading = false,
  onAllow,
}: {
  icon: string
  label: string
  granted: boolean
  loading?: boolean
  onAllow: () => void
}) {
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const t = useT()

  return (
    <View style={styles.permRow} testID={`setup-perm-${icon}`}>
      <View style={[styles.permIcon, granted && styles.permIconDone]}>
        <FontAwesome5 name={icon} size={14} color={granted ? colors.surface : colors.amber} />
      </View>
      <Text style={styles.permLabel}>{label}</Text>
      <Text style={[styles.permStatus, granted && styles.permStatusDone]}>
        {loading ? '…' : granted ? t('setup.s4.allowed') : t('setup.s4.denied')}
      </Text>
      {!granted ? (
        <Pressable
          onPress={onAllow}
          style={styles.allowBtn}
          accessibilityRole="button"
          accessibilityLabel={`${t('setup.s4.allow')} ${label}`}
        >
          <Text style={styles.allowText}>{t('setup.s4.allow')}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

/* ── Step 5 — app lock ───────────────────────────────────────────────────── */

function LockStep() {
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const t = useT()
  const { status } = useAuth()
  const on = status === 'locked' || status === 'unlocked'

  return (
    <View style={styles.step}>
      <View style={[styles.statusCard, on && styles.statusCardDone]}>
        <View style={[styles.statusIcon, on && styles.statusIconDone]}>
          <FontAwesome5 name={on ? 'check' : 'lock'} size={14} color={on ? colors.surface : colors.amber} />
        </View>
        <View style={styles.statusText}>
          <Text style={styles.statusTitle}>{on ? t('setup.s5.on') : t('setup.s5.off')}</Text>
        </View>
      </View>

      <Pressable
        style={styles.secondaryBtn}
        onPress={() => router.push('/settings/security')}
        accessibilityRole="button"
        accessibilityLabel={t('setup.s5.manage')}
      >
        <Text style={styles.secondaryBtnText}>{t('setup.s5.manage')}</Text>
      </Pressable>
    </View>
  )
}

/* ── Step 6 — done ───────────────────────────────────────────────────────── */

function DoneStep() {
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const t = useT()
  const signals = useSetupSignals()
  const progress = setupProgress(signals)

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
  }, [])

  return (
    <View style={styles.step}>
      <View style={styles.checklist}>
        {progress.items.map((item, i) => (
          <View
            key={item.key}
            style={[styles.checkRow, i < progress.items.length - 1 && styles.checkRowBordered]}
            testID={`setup-check-${item.key}`}
          >
            <View style={[styles.checkDot, item.done && styles.checkDotDone]}>
              <FontAwesome5
                name={item.done ? 'check' : 'circle'}
                size={item.done ? 10 : 6}
                color={item.done ? colors.surface : colors.textDim}
              />
            </View>
            <Text style={[styles.checkLabel, !item.done && styles.checkLabelPending]}>{t(CHECK_LABELS[item.key])}</Text>
            {!item.done ? <Text style={styles.checkPending}>{t('setup.check.pending')}</Text> : null}
          </View>
        ))}
      </View>
    </View>
  )
}

/* ── Styles ──────────────────────────────────────────────────────────────── */

const makeStyles = (colors: Colors) =>
  createStyles({
    safe: { flex: 1, backgroundColor: colors.bg },
    flex: { flex: 1 },

    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.md,
    },
    brandTile: {
      width: 28,
      height: 28,
      borderRadius: radii.sm,
      backgroundColor: colors.amberDim,
      borderWidth: 1,
      borderColor: `${colors.amber}66`,
      alignItems: 'center',
      justifyContent: 'center',
    },
    eyebrow: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xs,
      color: colors.textMuted,
      letterSpacing: 1.5,
      textTransform: 'uppercase',
    },

    dotsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.lg,
    },
    dot: { height: 8, borderRadius: radii.full },
    dotActive: { width: 24, backgroundColor: colors.amber },
    dotInactive: { width: 8, backgroundColor: colors.borderMid },

    content: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl },
    title: {
      fontSize: fontSizes['3xl'],
      fontWeight: fontWeights.bold,
      color: colors.textPrimary,
      letterSpacing: -0.4,
      marginBottom: spacing.sm,
    },
    body: { fontSize: fontSizes.md, color: colors.textSecondary, lineHeight: 20, marginBottom: spacing.xl },

    step: { width: '100%' },

    // Step 1 — profile
    photoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.lg,
      marginBottom: spacing.sm,
    },
    photoWrap: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: colors.borderMid,
      borderWidth: 2,
      borderColor: colors.amber,
      alignItems: 'center',
      justifyContent: 'center',
    },
    photoImg: { width: '100%', height: '100%', borderRadius: 36 },
    photoInitials: { fontSize: fontSizes['4xl'], fontWeight: fontWeights.bold, color: colors.amber },
    photoBadge: {
      position: 'absolute',
      right: -2,
      bottom: -2,
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: colors.amber,
      borderWidth: 2,
      borderColor: colors.bg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    photoCopy: { flex: 1 },
    photoTitle: { fontSize: fontSizes.lg, fontWeight: fontWeights.semibold, color: colors.textPrimary },
    photoHint: { fontSize: fontSizes.xs, color: colors.textMuted, marginTop: 3 },

    label: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xxs,
      color: colors.textDim,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      marginTop: spacing.lg,
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
    inputBio: { minHeight: 74, textAlignVertical: 'top' },
    inputError: { borderColor: colors.danger },
    fieldError: { fontSize: fontSizes.xs, color: colors.dangerText, marginTop: 4 },

    // Status cards (steps 2/3/5)
    statusCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.lg,
      padding: spacing.lg,
    },
    statusCardDone: { borderColor: `${colors.sage}80`, backgroundColor: colors.sageDim },
    statusIcon: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.amberDim,
      alignItems: 'center',
      justifyContent: 'center',
    },
    statusIconDone: { backgroundColor: colors.sage },
    statusText: { flex: 1 },
    statusTitle: { fontSize: fontSizes.md, fontWeight: fontWeights.semibold, color: colors.textPrimary },
    statusSub: { fontFamily: 'monospace', fontSize: fontSizes.xs, color: colors.textMuted, marginTop: 3 },
    loadingRow: { paddingVertical: spacing.md },

    primaryBtn: {
      marginTop: spacing.xl,
      backgroundColor: colors.amber,
      borderRadius: radii.lg,
      paddingVertical: spacing.lg,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 48,
    },
    primaryBtnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.borderMid },
    primaryBtnText: { fontSize: fontSizes.lg, fontWeight: fontWeights.bold, color: colors.surface },
    primaryBtnGhostText: { color: colors.textSecondary },
    secondaryBtn: {
      marginTop: spacing.md,
      borderWidth: 1,
      borderColor: colors.borderMid,
      borderRadius: radii.lg,
      paddingVertical: spacing.md,
      alignItems: 'center',
    },
    secondaryBtnText: { fontSize: fontSizes.md, fontWeight: fontWeights.semibold, color: colors.textSecondary },
    hint: { fontSize: fontSizes.xs, color: colors.textMuted, marginTop: spacing.md, lineHeight: 17 },

    // Step 4 — permissions
    permRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.lg,
      padding: spacing.md,
      marginBottom: spacing.sm,
    },
    permIcon: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: colors.amberDim,
      alignItems: 'center',
      justifyContent: 'center',
    },
    permIconDone: { backgroundColor: colors.sage },
    permLabel: { flex: 1, fontSize: fontSizes.md, fontWeight: fontWeights.medium, color: colors.textPrimary },
    permStatus: { fontFamily: 'monospace', fontSize: fontSizes.xxs, color: colors.textMuted },
    permStatusDone: { color: colors.sage },
    allowBtn: {
      borderWidth: 1,
      borderColor: colors.amber,
      borderRadius: radii.full,
      paddingHorizontal: spacing.md,
      paddingVertical: 5,
    },
    allowText: { fontSize: fontSizes.xs, fontWeight: fontWeights.semibold, color: colors.amber },

    // Step 6 — checklist
    checklist: {
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.lg,
      paddingHorizontal: spacing.lg,
    },
    checkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
    checkRowBordered: { borderBottomWidth: 1, borderBottomColor: colors.border },
    checkDot: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 1,
      borderColor: colors.borderMid,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkDotDone: { backgroundColor: colors.sage, borderColor: colors.sage },
    checkLabel: { flex: 1, fontSize: fontSizes.md, color: colors.textPrimary },
    checkLabelPending: { color: colors.textDim },
    checkPending: { fontFamily: 'monospace', fontSize: fontSizes.xxs, color: colors.textDim },

    // Footer
    footer: {
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.md,
      paddingBottom: spacing.lg,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.surface,
      gap: spacing.sm,
    },
    footerNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    navBtn: { paddingVertical: spacing.xs, paddingHorizontal: spacing.xs },
    navText: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xs,
      color: colors.textMuted,
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    cta: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      backgroundColor: colors.amber,
      borderRadius: radii.lg,
      paddingVertical: spacing.lg,
      paddingHorizontal: spacing['2xl'],
      width: '100%',
    },
    ctaText: { color: colors.surface, fontSize: fontSizes.xl, fontWeight: fontWeights.bold },
  })
