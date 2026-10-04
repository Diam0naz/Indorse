/**
 * app/settings/notifications.tsx — Notification settings
 *
 * Master delivery switch, per-category switches (which decide what reaches
 * the in-app feed rendered by `NotificationsProvider`) and quiet hours.
 * Everything persists through `SettingsProvider`.
 */

import { useState } from 'react'
import { View } from 'react-native'
import {
  OptionRow,
  OptionSheet,
  SettingsGroup,
  SettingsNote,
  SettingsScreen,
  ToggleRow,
} from '@/components/settings-ui'
import { useSettings } from '@/components/settings-provider'
import { useT } from '@/lib/i18n'
import { spacing } from '@/constants/theme'

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: `${String(hour).padStart(2, '0')}:00`,
}))

const formatHour = (hour: number) => `${String(hour).padStart(2, '0')}:00`

export default function NotificationSettingsScreen() {
  const { notifications: prefs, setNotifications } = useSettings()
  const t = useT()
  const [sheet, setSheet] = useState<'from' | 'to' | null>(null)

  return (
    <SettingsScreen title={t('notifSettings.title')} subtitle={t('notifSettings.subtitle')}>
      <SettingsGroup label={t('notifSettings.delivery')}>
        <ToggleRow
          title={t('notifSettings.push')}
          description={t('notifSettings.pushBody')}
          value={prefs.push}
          onValueChange={(push) => setNotifications({ push })}
        />
        <ToggleRow
          title={t('notifSettings.badge')}
          description={t('notifSettings.badgeBody')}
          value={prefs.badge}
          onValueChange={(badge) => setNotifications({ badge })}
          disabled={!prefs.push}
          last
        />
      </SettingsGroup>

      <SettingsGroup label={t('notifSettings.categories')}>
        <ToggleRow
          title={t('notifSettings.diagnosis')}
          description={t('notifSettings.diagnosisBody')}
          value={prefs.diagnosis}
          onValueChange={(diagnosis) => setNotifications({ diagnosis })}
          disabled={!prefs.push}
        />
        <ToggleRow
          title={t('notifSettings.escrow')}
          description={t('notifSettings.escrowBody')}
          value={prefs.escrow}
          onValueChange={(escrow) => setNotifications({ escrow })}
          disabled={!prefs.push}
        />
        <ToggleRow
          title={t('notifSettings.weather')}
          description={t('notifSettings.weatherBody')}
          value={prefs.weather}
          onValueChange={(weather) => setNotifications({ weather })}
          disabled={!prefs.push}
        />
        <ToggleRow
          title={t('notifSettings.system')}
          description={t('notifSettings.systemBody')}
          value={prefs.system}
          onValueChange={(system) => setNotifications({ system })}
          disabled={!prefs.push}
          last
        />
      </SettingsGroup>

      {!prefs.push && (
        <View style={{ marginTop: -spacing.sm }}>
          <SettingsNote>{t('notifSettings.pushOff')}</SettingsNote>
        </View>
      )}

      <SettingsGroup label={t('notifSettings.quiet')}>
        <ToggleRow
          title={t('notifSettings.quietToggle')}
          description={t('notifSettings.quietToggleBody')}
          value={prefs.quiet}
          onValueChange={(quiet) => setNotifications({ quiet })}
        />
        <OptionRow
          title={t('notifSettings.from')}
          valueLabel={formatHour(prefs.quietFrom)}
          onPress={() => setSheet('from')}
          disabled={!prefs.quiet}
        />
        <OptionRow
          title={t('notifSettings.to')}
          valueLabel={formatHour(prefs.quietTo)}
          onPress={() => setSheet('to')}
          disabled={!prefs.quiet}
          last
        />
      </SettingsGroup>

      <OptionSheet
        visible={sheet === 'from'}
        title={t('notifSettings.from')}
        options={HOUR_OPTIONS}
        selected={String(prefs.quietFrom)}
        onSelect={(value) => setNotifications({ quietFrom: Number(value) })}
        onClose={() => setSheet(null)}
      />
      <OptionSheet
        visible={sheet === 'to'}
        title={t('notifSettings.to')}
        options={HOUR_OPTIONS}
        selected={String(prefs.quietTo)}
        onSelect={(value) => setNotifications({ quietTo: Number(value) })}
        onClose={() => setSheet(null)}
      />
    </SettingsScreen>
  )
}
