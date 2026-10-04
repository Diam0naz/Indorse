/**
 * app/settings/export.tsx — Export farm record as CSV
 *
 * Reads the record live — farm, reports, escrow, policy and oracle through
 * the same hooks the tabs use — hands it to `lib/csv.ts`, and shows a
 * contents summary and a raw preview before sharing the `.csv` file
 * (written to the cache dir and handed to the system share sheet) or
 * copying the document to the clipboard. Sharing failure degrades to the
 * copy path instead of failing silently.
 *
 * Nothing is exported before the reads settle: an honest banner explains
 * guest / no-farm / loading / RPC-failure states and the buttons stay
 * disabled until there is a real record to write.
 */

import { useMemo, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import Clipboard from '@react-native-clipboard/clipboard'
import { cacheDirectory, EncodingType, writeAsStringAsync } from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { Banner, SectionLabel } from '@/components/screen-kit'
import { useProfile } from '@/components/profile-provider'
import { SettingsButton, SettingsGroup, SettingsNote, SettingsScreen, SettingRow } from '@/components/settings-ui'
import { useTheme } from '@/components/theme-provider'
import { createStyles, fontSizes, spacing, type Colors } from '@/constants/theme'
import { useEscrowQuery } from '@/features/escrow/useEscrowQuery'
import { useFarmQuery } from '@/features/farm/useFarmQuery'
import { usePolicyQuery } from '@/features/insurance/usePolicyQuery'
import { useWeatherOracleQuery } from '@/features/insurance/useWeatherOracleQuery'
import { useReportsQuery } from '@/features/reports/useReportsQuery'
import { buildFieldsFromReports } from '@/features/scout/fields'
import { useMobileWalletSetup } from '@/features/wallet/useMobileWalletSetup'
import {
  buildFarmRecordCsv,
  farmRecordFileName,
  farmRecordRowCount,
  farmRecordSections,
  type FarmRecordInput,
} from '@/lib/csv'
import { useT } from '@/lib/i18n'

const PREVIEW_LINES = 30

type ShareState = 'idle' | 'writing' | 'error'

export default function ExportSettingsScreen() {
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const t = useT()

  const { address } = useMobileWalletSetup()
  const { profile } = useProfile()

  // Live record — the same reads the tabs already perform.
  const farmQuery = useFarmQuery()
  const farm = farmQuery.farm
  const farmAddress = farmQuery.farmAddress
  const reportsQuery = useReportsQuery(
    farm && farmAddress ? { address: farmAddress, reportCount: farm.reportCount } : null,
  )
  const escrowQuery = useEscrowQuery(farm && farmAddress ? { farmAddress, batchCount: farm.batchCount } : null)
  const policyQuery = usePolicyQuery(farm && farmAddress ? { farmAddress, policyCount: farm.policyCount } : null)
  const readingQuery = useWeatherOracleQuery(
    farmAddress && policyQuery.policy ? { farmAddress, seasonStart: policyQuery.policy.seasonStart } : null,
  )

  const fields = useMemo(
    () => (farm ? buildFieldsFromReports(reportsQuery.reports, farm.name) : []),
    [farm, reportsQuery.reports],
  )

  const record: FarmRecordInput = useMemo(
    () => ({
      farm,
      operator: profile?.name.trim() ?? '',
      reports: reportsQuery.reports,
      fields,
      escrow: escrowQuery.escrow
        ? {
            buyer: escrowQuery.escrow.buyer,
            amountUsdc: escrowQuery.escrow.amountUsdc,
            address: escrowQuery.escrow.address ?? escrowQuery.escrowAddress ?? undefined,
          }
        : null,
      policy: policyQuery.policy
        ? {
            coverageUsdc: policyQuery.policy.coverageUsdc,
            premiumUsdc: policyQuery.policy.premiumUsdc,
            triggerThresholdMm: policyQuery.policy.triggerThresholdMm,
            seasonStart: policyQuery.policy.seasonStart,
            seasonEnd: policyQuery.policy.seasonEnd,
            state: policyQuery.policy.state,
            address: policyQuery.policyAddress ?? undefined,
          }
        : null,
      reading: readingQuery.reading,
      exportedAt: new Date(),
    }),
    [
      farm,
      profile,
      reportsQuery.reports,
      fields,
      escrowQuery.escrow,
      escrowQuery.escrowAddress,
      policyQuery.policy,
      policyQuery.policyAddress,
      readingQuery.reading,
    ],
  )

  const csv = useMemo(() => buildFarmRecordCsv(record), [record])
  const sections = useMemo(() => farmRecordSections(record), [record])
  const rowCount = farmRecordRowCount(record)
  const preview = useMemo(() => csv.split('\n').slice(0, PREVIEW_LINES).join('\n'), [csv])

  const [state, setState] = useState<ShareState>('idle')
  const [copied, setCopied] = useState(false)

  const chainError = !!address && farmQuery.state === 'error'
  const loading =
    !!address &&
    (farmQuery.state === 'loading' ||
      (!!farm &&
        (reportsQuery.state === 'loading' ||
          escrowQuery.state === 'loading' ||
          policyQuery.state === 'loading' ||
          (!!policyQuery.policy && readingQuery.state === 'loading'))))
  const noFarm = !!address && farmQuery.state === 'ready' && !farm
  const canExport = !chainError && !loading && rowCount > 0

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
      const uri = `${cacheDirectory}${farmRecordFileName(record.farm?.name ?? null, record.exportedAt)}`
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

      {/* One honest banner for why the record is not exportable (yet). */}
      {chainError ? (
        <Banner
          tone="danger"
          title={t('export.chainError.title')}
          message={t('export.chainError.body')}
          actionLabel={t('export.retry')}
          onAction={farmQuery.retry}
        />
      ) : loading ? (
        <Banner tone="info" title={t('export.loading.title')} message={t('export.loading.body')} />
      ) : !address ? (
        <Banner tone="warning" title={t('export.unavailable.title')} message={t('export.unavailable.body')} />
      ) : noFarm ? (
        <Banner tone="warning" title={t('export.empty.title')} message={t('export.empty.body')} />
      ) : null}

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
          {t('export.rows', { n: rowCount })} · {csv.length} bytes
        </Text>
      </View>

      <View style={styles.actions}>
        <SettingsButton
          label={state === 'writing' ? t('export.writing') : t('export.share')}
          onPress={() => void shareCsv()}
          busy={state === 'writing'}
          disabled={!canExport}
        />
        <SettingsButton
          label={copied ? t('export.copied') : t('export.copy')}
          tone="secondary"
          onPress={copyCsv}
          disabled={!canExport}
        />
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
