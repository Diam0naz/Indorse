/**
 * app/settings/export.tsx — Export farm record as CSV
 *
 * Builds the record with `lib/csv.ts`, shows a contents summary and a raw
 * preview, then either shares the `.csv` file (written to the cache dir and
 * handed to the system share sheet) or copies the document to the
 * clipboard. Sharing failure degrades to the copy path instead of failing
 * silently.
 */

import { useMemo, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import Clipboard from '@react-native-clipboard/clipboard'
import { cacheDirectory, EncodingType, writeAsStringAsync } from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { Banner, SectionLabel } from '@/components/screen-kit'
import { SettingsButton, SettingsGroup, SettingsNote, SettingsScreen, SettingRow } from '@/components/settings-ui'
import { useTheme } from '@/components/theme-provider'
import { createStyles, fontSizes, spacing, type Colors } from '@/constants/theme'
import { buildFarmRecordCsv, farmRecordFileName, farmRecordRowCount, farmRecordSections } from '@/lib/csv'
import { useT } from '@/lib/i18n'

const PREVIEW_LINES = 30

type ShareState = 'idle' | 'writing' | 'error'

export default function ExportSettingsScreen() {
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const t = useT()

  // Static seed record → build once.
  const csv = useMemo(() => buildFarmRecordCsv(new Date(2026, 8, 28)), [])
  const sections = useMemo(() => farmRecordSections(), [])
  const preview = useMemo(() => csv.split('\n').slice(0, PREVIEW_LINES).join('\n'), [csv])

  const [state, setState] = useState<ShareState>('idle')
  const [copied, setCopied] = useState(false)

  function copyCsv() {
    Clipboard.setString(csv)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  async function shareCsv() {
    setState('writing')
    try {
      const available = await Sharing.isAvailableAsync()
      if (!available || !cacheDirectory) throw new Error('sharing unavailable')
      const uri = `${cacheDirectory}${farmRecordFileName(new Date(2026, 8, 28))}`
      await writeAsStringAsync(uri, csv, { encoding: EncodingType.UTF8 })
      await Sharing.shareAsync(uri, {
        mimeType: 'text/csv',
        dialogTitle: t('export.share'),
        UTI: 'public.comma-separated-values-text',
      })
      setState('idle')
    } catch {
      setState('error')
    }
  }

  return (
    <SettingsScreen title={t('export.title')} subtitle={t('export.subtitle')}>
      {state === 'error' && <Banner tone="danger" title={t('export.error.title')} message={t('export.error.body')} />}

      <SettingsGroup label={t('export.contents')}>
        {sections.map((section, index) => (
          <SettingRow key={section.key} title={t(`export.sec.${section.key}`)} last={index === sections.length - 1}>
            <Text style={styles.rowCount}>{t('export.rows', { n: section.count })}</Text>
          </SettingRow>
        ))}
      </SettingsGroup>

      <View>
        <SectionLabel>{t('export.preview')}</SectionLabel>
        <ScrollView style={styles.previewBox} nestedScrollEnabled bounces={false}>
          <Text style={styles.preview} selectable>
            {preview}
          </Text>
        </ScrollView>
        <Text style={styles.previewMeta}>
          {t('export.rows', { n: farmRecordRowCount() })} · {csv.length} bytes
        </Text>
      </View>

      <View style={styles.actions}>
        <SettingsButton
          label={state === 'writing' ? t('export.writing') : t('export.share')}
          onPress={() => void shareCsv()}
          busy={state === 'writing'}
        />
        <SettingsButton label={copied ? t('export.copied') : t('export.copy')} tone="secondary" onPress={copyCsv} />
      </View>

      <SettingsNote>{t('export.note')}</SettingsNote>
    </SettingsScreen>
  )
}

const makeStyles = (colors: Colors) =>
  createStyles({
    rowCount: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xs,
      color: colors.textSecondary,
      letterSpacing: 0.6,
    },
    previewBox: {
      maxHeight: 260,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      borderRadius: spacing.sm,
      padding: spacing.md,
    },
    preview: {
      fontFamily: 'monospace',
      fontSize: 10,
      lineHeight: 15,
      color: colors.textSecondary,
    },
    previewMeta: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xxs,
      color: colors.textDim,
      letterSpacing: 1,
      marginTop: spacing.xs,
      textTransform: 'uppercase',
    },
    actions: {
      gap: spacing.md,
    },
  })
