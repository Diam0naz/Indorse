/**
 * app/settings/security.tsx — Wallet & Security
 *
 * Wallet identity (friendly name + copyable address), signing/session
 * preferences, the balance-masking display switch and local data controls.
 * Signing itself stays with Mobile Wallet Adapter — see the note at the
 * bottom of the screen.
 */

import { useEffect, useState } from 'react'
import { Alert, Pressable, Text } from 'react-native'
import Clipboard from '@react-native-clipboard/clipboard'
import { VerifyEmailModal } from '@/components/verify-email-modal'
import {
  OptionRow,
  OptionSheet,
  SettingsButton,
  SettingsGroup,
  SettingsNote,
  SettingsScreen,
  SettingRow,
  ToggleRow,
} from '@/components/settings-ui'
import { useAuth } from '@/components/auth-provider'
import { useSettings, type AutoLock } from '@/components/settings-provider'
import { useTheme } from '@/components/theme-provider'
import { useMobileWalletSetup } from '@/features/wallet/useMobileWalletSetup'
import { useDeviceVerification } from '@/features/wallet/useDeviceVerification'
import { getVerifiedEmail } from '@/features/email/verifiedEmailStore'
import { createStyles, fontSizes, spacing, type Colors } from '@/constants/theme'
import { trunc } from '@/constants/data'
import { walletName } from '@/lib/wallet-name'
import { useT } from '@/lib/i18n'

export default function SecuritySettingsScreen() {
  const { security, setSecurity, reset } = useSettings()
  const { reset: forgetAppPasscode, recoveryEmailOnFile, recoveryEmailVerified } = useAuth()
  const { walletState, address, toggleConnection } = useMobileWalletSetup()
  const verification = useDeviceVerification()
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const t = useT()
  const [lockSheet, setLockSheet] = useState(false)
  const [copied, setCopied] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null)

  // Re-read the remembered email whenever the modal opens or closes, so the
  // row flips to its verified form right after a successful confirmation.
  useEffect(() => {
    let cancelled = false
    getVerifiedEmail()
      .then((record) => {
        if (!cancelled) setVerifiedEmail(record?.email ?? null)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [emailOpen])

  const connected = walletState === 'connected' && address !== null

  // Roadmap #5: the device-verified mark. The verdict itself comes from the
  // server (see useDeviceVerification) — this block only displays it.
  const verifyStatus = verification.status
  const verifyTitle =
    verifyStatus === 'verified'
      ? `✓ ${t('security.deviceVerified')}`
      : verifyStatus === 'verifying'
        ? t('security.verifying')
        : verifyStatus === 'unverified'
          ? t('security.deviceUnverified')
          : verifyStatus === 'error'
            ? t('security.deviceVerifyError')
            : t('security.verifyCta')
  const verifyBody =
    verifyStatus === 'verified'
      ? t('security.deviceVerifiedBody')
      : verifyStatus === 'unverified'
        ? t('security.deviceUnverifiedBody')
        : t('security.deviceIdleBody')
  const verifyAction = verifyStatus === 'idle' || verifyStatus === 'error' || verifyStatus === 'unverified'

  const lockOptions: { value: string; label: string }[] = [
    { value: 'immediate', label: t('security.lock.immediate') },
    { value: '1', label: t('security.lock.1') },
    { value: '5', label: t('security.lock.5') },
    { value: '15', label: t('security.lock.15') },
    { value: 'never', label: t('security.lock.never') },
  ]

  function copyAddress() {
    if (!address) return
    Clipboard.setString(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function confirmClear() {
    Alert.alert(t('security.clearConfirm'), t('security.clearConfirmBody'), [
      { text: t('security.cancel'), style: 'cancel' },
      {
        text: t('security.confirm'),
        style: 'destructive',
        onPress: () => {
          reset()
          Alert.alert(t('security.cleared'))
        },
      },
    ])
  }

  /** Forget the app passcode → the auth gate re-opens in register mode. */
  function confirmChangePasscode() {
    Alert.alert(t('security.changePasscode'), t('security.changePasscodeBody'), [
      { text: t('security.cancel'), style: 'cancel' },
      {
        text: t('security.confirm'),
        onPress: () => {
          void forgetAppPasscode()
        },
      },
    ])
  }

  return (
    <SettingsScreen title={t('security.title')} subtitle={t('security.subtitle')}>
      <SettingsGroup label={t('security.wallet')}>
        {connected && address ? (
          <>
            <SettingRow title={t('security.walletName')}>
              <Text style={styles.trailingText}>{walletName(address)}</Text>
            </SettingRow>
            <SettingRow title={t('security.address')} last>
              <Pressable onPress={copyAddress} accessibilityRole="button" accessibilityLabel={t('prov.copy')}>
                <Text style={styles.copyLink}>{copied ? t('prov.copied') : t('prov.copy')}</Text>
              </Pressable>
              <Text style={styles.trailingText}>{trunc(address, 6, 4)}</Text>
            </SettingRow>
          </>
        ) : (
          <SettingRow title={t('profile.connectPrompt')} description={t('profile.connectPromptBody')} last />
        )}
      </SettingsGroup>

      <SettingsButton
        label={connected ? t('security.disconnect') : t('wallet.connect')}
        tone={connected ? 'danger' : 'primary'}
        busy={walletState === 'connecting'}
        onPress={() => void toggleConnection()}
      />

      {connected ? (
        <SettingsGroup label={t('security.device')}>
          <SettingRow
            title={verifyTitle}
            description={verifyBody}
            onPress={verifyAction ? () => void verification.verify() : undefined}
            disabled={verifyStatus === 'verifying'}
            last
          />
        </SettingsGroup>
      ) : null}

      {connected ? (
        <SettingsGroup label={t('security.email')}>
          <SettingRow
            title={verifiedEmail ? t('security.emailVerified') : t('security.emailCta')}
            description={verifiedEmail ?? t('security.emailIdleBody')}
            onPress={() => setEmailOpen(true)}
            last
          />
        </SettingsGroup>
      ) : null}

      <SettingsGroup label={t('security.signing')}>
        <ToggleRow
          title={t('security.confirmSign')}
          description={t('security.confirmSignBody')}
          value={security.confirmSignatures}
          onValueChange={(confirmSignatures) => setSecurity({ confirmSignatures })}
        />
        <ToggleRow
          title={t('security.deviceUnlock')}
          description={t('security.deviceUnlockBody')}
          value={security.deviceUnlock}
          onValueChange={(deviceUnlock) => setSecurity({ deviceUnlock })}
        />
        <ToggleRow
          title={t('security.biometrics')}
          description={t('security.biometricsBody')}
          value={security.biometrics}
          onValueChange={(biometrics) => setSecurity({ biometrics })}
          last
        />
      </SettingsGroup>

      <SettingsGroup label={t('security.session')}>
        <OptionRow
          title={t('security.autoLock')}
          description={t('security.autoLockBody')}
          valueLabel={lockOptions.find((option) => option.value === security.autoLock)?.label ?? t('security.lock.5')}
          onPress={() => setLockSheet(true)}
          last
        />
      </SettingsGroup>

      <SettingsGroup label={t('auth.unlock.passcode')}>
        <SettingRow
          title={t('security.recoveryEmail')}
          description={
            !recoveryEmailOnFile
              ? t('security.recoveryEmailNone')
              : recoveryEmailVerified
                ? t('security.recoveryEmailVerified')
                : t('security.recoveryEmailOnFile')
          }
        />
        <SettingRow
          title={t('security.changePasscode')}
          description={t('security.changePasscodeBody')}
          onPress={confirmChangePasscode}
          last
        />
      </SettingsGroup>

      <SettingsGroup label={t('security.display')}>
        <ToggleRow
          title={t('security.hideBalances')}
          description={t('security.hideBalancesBody')}
          value={security.hideBalances}
          onValueChange={(hideBalances) => setSecurity({ hideBalances })}
          last
        />
      </SettingsGroup>

      <SettingsGroup label={t('security.data')}>
        <SettingRow title={t('security.clear')} description={t('security.clearBody')} onPress={confirmClear} last />
      </SettingsGroup>

      <SettingsNote>{t('security.keysNote')}</SettingsNote>

      <OptionSheet
        visible={lockSheet}
        title={t('security.autoLock')}
        options={lockOptions}
        selected={security.autoLock}
        onSelect={(value) => setSecurity({ autoLock: value as AutoLock })}
        onClose={() => setLockSheet(false)}
      />

      {emailOpen && (
        <VerifyEmailModal onClose={() => setEmailOpen(false)} onVerified={(email) => setVerifiedEmail(email)} />
      )}
    </SettingsScreen>
  )
}

const makeStyles = (colors: Colors) =>
  createStyles({
    trailingText: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xs,
      color: colors.textSecondary,
      letterSpacing: 0.6,
    },
    copyLink: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xs,
      color: colors.sky,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      marginRight: spacing.xs,
    },
  })
