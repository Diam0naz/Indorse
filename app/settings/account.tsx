/**
 * app/settings/account.tsx — Account & local data
 *
 * The app has no server-side accounts: identity, registry and preferences
 * live on this device, and signing stays with Mobile Wallet Adapter. This
 * screen spells out exactly what "delete account" erases — the on-device
 * stores plus the wallet session — and says plainly that on-chain records
 * are not affected. Each store is cleared through its own provider so the
 * in-memory state and the persisted document always agree.
 */

import { useState } from 'react'
import { ConfirmModal } from '@/components/confirm-modal'
import { SettingsButton, SettingsGroup, SettingsNote, SettingsScreen, SettingRow } from '@/components/settings-ui'
import { useAuth } from '@/components/auth-provider'
import { useFarmRegistry } from '@/components/farm-registry-provider'
import { useNotifications } from '@/components/notifications'
import { useProfile } from '@/components/profile-provider'
import { useScoutLog } from '@/components/scout-log-provider'
import { useSettings } from '@/components/settings-provider'
import { clearEvidence } from '@/features/scout/evidence'
import { useMobileWalletSetup } from '@/features/wallet/useMobileWalletSetup'
import { useT } from '@/lib/i18n'

export default function AccountSettingsScreen() {
  const t = useT()
  const { reset: resetSettings } = useSettings()
  const { reset: resetAuth } = useAuth()
  const { clearProfile } = useProfile()
  const { reset: resetRegistry } = useFarmRegistry()
  const { reset: resetScoutLog } = useScoutLog()
  const { clear: clearNotifications } = useNotifications()
  const { walletState, toggleConnection } = useMobileWalletSetup()

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [done, setDone] = useState(false)

  async function erase() {
    // Device stores first — nothing here ever reaches the chain.
    resetSettings()
    resetRegistry()
    resetScoutLog()
    clearProfile()
    clearNotifications()
    // The scouting log's evidence photos live in app storage too; rows are
    // gone, so the pixels they point at go with them.
    await clearEvidence()
    await resetAuth()
    // The session ends too; the wallet itself stays with the wallet app.
    if (walletState === 'connected') await toggleConnection()
    setDone(true)
  }

  const stores: { title: string; description: string }[] = [
    { title: t('account.farms'), description: t('account.farmsBody') },
    { title: t('account.scout'), description: t('account.scoutBody') },
    { title: t('account.profile'), description: t('account.profileBody') },
    { title: t('account.settings'), description: t('account.settingsBody') },
    { title: t('account.security'), description: t('account.securityBody') },
    { title: t('account.notifications'), description: t('account.notificationsBody') },
    { title: t('account.wallet'), description: t('account.walletBody') },
  ]

  return (
    <SettingsScreen title={t('account.title')} subtitle={t('account.subtitle')}>
      <SettingsGroup label={t('account.storesLabel')}>
        {stores.map((row, i) => (
          <SettingRow key={row.title} title={row.title} description={row.description} last={i === stores.length - 1} />
        ))}
      </SettingsGroup>

      <SettingsGroup label={t('account.chainLabel')}>
        <SettingsNote>{t('account.chainNote')}</SettingsNote>
      </SettingsGroup>

      {done ? (
        <SettingsGroup label={t('account.doneLabel')}>
          <SettingsNote>{t('account.done')}</SettingsNote>
        </SettingsGroup>
      ) : null}

      <SettingsButton label={t('account.confirm')} tone="danger" onPress={() => setConfirmOpen(true)} />

      {confirmOpen ? (
        <ConfirmModal
          title={t('account.confirmTitle')}
          lead={t('account.confirmLead')}
          bullets={[t('account.confirmBulletStores'), t('account.confirmBulletChain')]}
          confirmLabel={t('account.confirm')}
          busyLabel={t('account.confirming')}
          requireWallet={false}
          testID="delete-account-confirm"
          danger
          onConfirm={erase}
          onClose={() => setConfirmOpen(false)}
        />
      ) : null}
    </SettingsScreen>
  )
}
