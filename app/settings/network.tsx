/**
 * app/settings/network.tsx — Network settings
 *
 * Pick the cluster (mainnet/devnet/testnet/localnet or a custom RPC) and
 * verify the endpoint with a real JSON-RPC `getSlot` round trip: the screen
 * shows checking / healthy / unreachable states with latency and slot.
 *
 * Switching the cluster rebuilds the wallet provider's cluster, so the
 * current wallet session is dropped — the note on screen says as much.
 */

import { useCallback, useEffect, useState } from 'react'
import { Alert, Text, TextInput, View } from 'react-native'
import Clipboard from '@react-native-clipboard/clipboard'
import { ErrorState, Skeleton } from '@/components/screen-kit'
import {
  OptionRow,
  OptionSheet,
  SettingsButton,
  SettingsGroup,
  SettingsNote,
  SettingsScreen,
  SettingRow,
} from '@/components/settings-ui'
import { useSettings, type ClusterId } from '@/components/settings-provider'
import { useTheme } from '@/components/theme-provider'
import { CLUSTER_LABEL_KEYS, CLUSTER_URLS, PROGRAM_ID, rpcUrl } from '@/constants/app-config'
import { createStyles, fontSizes, spacing, type Colors } from '@/constants/theme'
import { useT } from '@/lib/i18n'

type Health =
  { status: 'idle' } | { status: 'checking' } | { status: 'ok'; ms: number; slot: number } | { status: 'error' }

const VALID_URL = /^https?:\/\/.+/i

export default function NetworkSettingsScreen() {
  const { network, setNetwork } = useSettings()
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const t = useT()

  const [health, setHealth] = useState<Health>({ status: 'idle' })
  const [clusterSheet, setClusterSheet] = useState(false)
  const [draft, setDraft] = useState(network.customRpc)
  const [draftError, setDraftError] = useState<string | null>(null)

  const url = rpcUrl(network)

  const check = useCallback(async () => {
    setHealth({ status: 'checking' })
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    const started = Date.now()
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSlot', params: [{ commitment: 'processed' }] }),
        signal: controller.signal,
      })
      const payload = (await response.json()) as { result?: unknown }
      if (typeof payload.result !== 'number') throw new Error('unexpected RPC response')
      setHealth({ status: 'ok', ms: Date.now() - started, slot: payload.result })
    } catch {
      setHealth({ status: 'error' })
    } finally {
      clearTimeout(timeout)
    }
  }, [url])

  // Re-check automatically whenever the endpoint changes. The probe starts in a
  // timer so the effect body itself stays free of state updates (the health
  // status is flipped to "checking" as soon as the timer runs).
  useEffect(() => {
    const timer = setTimeout(check, 0)
    return () => clearTimeout(timer)
  }, [check])

  function applyCustomRpc() {
    const value = draft.trim()
    if (!VALID_URL.test(value)) {
      setDraftError(t('network.customInvalid'))
      return
    }
    setDraftError(null)
    setNetwork({ customRpc: value })
    Alert.alert(t('network.custom'), value)
  }

  function copy(text: string) {
    Clipboard.setString(text)
  }

  const clusterOptions = (Object.keys(CLUSTER_LABEL_KEYS) as ClusterId[]).map((value) => ({
    value,
    label: t(CLUSTER_LABEL_KEYS[value]),
    hint: value === 'custom' ? draft.trim() || undefined : CLUSTER_URLS[value as Exclude<ClusterId, 'custom'>],
  }))

  return (
    <SettingsScreen title={t('network.title')} subtitle={t('network.subtitle')}>
      <SettingsGroup label={t('network.cluster')}>
        <OptionRow
          title={t('network.cluster')}
          valueLabel={t(CLUSTER_LABEL_KEYS[network.cluster])}
          onPress={() => setClusterSheet(true)}
          last
        />
      </SettingsGroup>

      {network.cluster === 'custom' && (
        <SettingsGroup label={t('network.customUrl')}>
          <View style={styles.inputBox}>
            <TextInput
              value={draft}
              onChangeText={(next) => {
                setDraft(next)
                setDraftError(null)
              }}
              placeholder={t('network.customPlaceholder')}
              placeholderTextColor={colors.textDim}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              accessibilityLabel={t('network.customUrl')}
              style={styles.input}
            />
            {draftError ? <Text style={styles.inputError}>{draftError}</Text> : null}
            <SettingsButton label={t('network.apply')} tone="secondary" onPress={applyCustomRpc} />
          </View>
        </SettingsGroup>
      )}

      <SettingsGroup label={t('network.health')}>
        <View style={styles.statusBox}>
          {health.status === 'idle' && <Text style={styles.statusIdle}>{t('network.idle')}</Text>}
          {health.status === 'checking' && (
            <View style={styles.statusStack}>
              <Text style={styles.statusIdle}>{t('network.checking')}</Text>
              <Skeleton height={12} width="60%" />
              <Skeleton height={12} width="40%" />
            </View>
          )}
          {health.status === 'ok' && (
            <View style={styles.statusStack}>
              <Text style={styles.statusOk}>{t('network.healthy', { ms: health.ms })}</Text>
              <Text style={styles.statusSlot}>
                {t('network.slot')} {health.slot}
              </Text>
            </View>
          )}
          {health.status === 'error' && (
            <ErrorState title={t('network.unhealthy')} message={t('network.unhealthyBody')} onRetry={check} />
          )}
          <SettingsButton
            label={t('network.check')}
            tone="secondary"
            busy={health.status === 'checking'}
            onPress={() => void check()}
          />
        </View>
        <SettingRow title={t('network.endpoint')} description={url} last />
      </SettingsGroup>

      <SettingsGroup label={t('network.programId')}>
        <SettingRow title={t('network.programId')} onPress={() => copy(PROGRAM_ID)} last>
          <Text style={styles.programId} numberOfLines={1}>
            {PROGRAM_ID.slice(0, 8)}…{PROGRAM_ID.slice(-6)}
          </Text>
        </SettingRow>
      </SettingsGroup>

      <SettingsNote>{t('network.switchNote')}</SettingsNote>

      <OptionSheet
        visible={clusterSheet}
        title={t('network.cluster')}
        options={clusterOptions}
        selected={network.cluster}
        onSelect={(value) => setNetwork({ cluster: value as ClusterId })}
        onClose={() => setClusterSheet(false)}
      />
    </SettingsScreen>
  )
}

const makeStyles = (colors: Colors) =>
  createStyles({
    statusBox: {
      padding: spacing.lg,
      gap: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    statusStack: {
      gap: 6,
    },
    statusIdle: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xs,
      color: colors.textMuted,
      letterSpacing: 0.6,
    },
    statusOk: {
      fontFamily: 'monospace',
      fontSize: fontSizes.sm,
      color: colors.sageLight,
      letterSpacing: 0.6,
    },
    statusSlot: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xxs,
      color: colors.textMuted,
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    inputBox: {
      padding: spacing.lg,
      gap: spacing.md,
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
    inputError: {
      fontSize: fontSizes.sm,
      color: colors.dangerText,
    },
    programId: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xs,
      color: colors.textSecondary,
      letterSpacing: 0.6,
      maxWidth: 190,
    },
  })
