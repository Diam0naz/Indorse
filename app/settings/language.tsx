/**
 * app/settings/language.tsx — Language switch
 *
 * English / Español / Français. The choice persists through
 * `LanguageProvider` and is applied immediately to navigation chrome, the
 * notifications sheet, screen section labels and every settings screen.
 * Seed content (crop names, diagnoses, addresses) is data and stays as
 * authored — the note at the bottom says so.
 */

import { Text, View } from 'react-native'
import { Card, SectionLabel } from '@/components/screen-kit'
import { OptionRow, SettingsGroup, SettingsNote, SettingsScreen } from '@/components/settings-ui'
import { useTheme } from '@/components/theme-provider'
import { fontSizes, fontWeights } from '@/constants/theme'
import { LANGUAGES, useI18n, type MessageKey } from '@/lib/i18n'

/** Sample labels drawn from the real screens, translated live. */
const PREVIEW_KEYS: MessageKey[] = ['scout.fields', 'prov.escrow', 'wx.policy', 'profile.farmDetails']

export default function LanguageSettingsScreen() {
  const { lang, setLang, t } = useI18n()
  const { colors } = useTheme()

  return (
    <SettingsScreen title={t('language.title')} subtitle={t('language.subtitle')}>
      <SettingsGroup label={t('language.subtitle')}>
        {LANGUAGES.map((language, index) => (
          <OptionRow
            key={language.code}
            title={language.native}
            description={language.label}
            valueLabel={language.code.toUpperCase()}
            selected={language.code === lang}
            onPress={() => setLang(language.code)}
            last={index === LANGUAGES.length - 1}
          />
        ))}
      </SettingsGroup>

      <View>
        <SectionLabel>{t('language.preview')}</SectionLabel>
        <Card>
          <View style={{ gap: 6 }}>
            {PREVIEW_KEYS.map((key) => (
              <Text
                key={key}
                style={{
                  fontSize: fontSizes.md,
                  fontWeight: fontWeights.medium,
                  color: colors.textSecondary,
                }}
              >
                {t(key)}
              </Text>
            ))}
          </View>
        </Card>
      </View>

      <SettingsNote>{t('language.note')}</SettingsNote>
    </SettingsScreen>
  )
}
