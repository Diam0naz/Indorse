/**
 * app/settings/admin.tsx — the operator console (`config.admin` surface).
 *
 * Gating: the Settings menu renders the entry only when the connected
 * wallet equals `config.admin` read from the chain, and this screen
 * re-checks the same value — but both are UX. Every action below sends an
 * instruction the program itself gates with `authority == config.admin`,
 * so hiding the pane is never the security boundary.
 *
 * Sections:
 *   identity    — who is connected, whether they hold the admin role
 *   roles       — set_roles (prefilled from config, typed confirmation)
 *   treasury    — balance + withdraw_treasury (typed confirmation)
 *   settlement  — settle readiness incl. the vault-solvency check: the
 *                 pre-demo "did I top up coverage?" checklist, made live
 *                 (vault balance vs policy coverage before you settle)
 *   oracle      — init/add/remove reader seats (Phase 2 set)
 *   verifier    — init/reconfigure/release/slash (Phase 1 bonded set)
 *   API admin   — SIWS-auth'd status + dev-allowlist management; every
 *                 call signs a fresh proof in the wallet, no session token
 *
 * Deliberate confirmation: value-moving instructions require typing the
 * exact instruction name into a modal (typed-confirm-modal); reversible
 * ops get a one-tap confirm.
 */

import { useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { SettingRow, SettingsButton, SettingsGroup, SettingsNote, SettingsScreen } from '@/components/settings-ui'
import { TypedConfirmModal } from '@/components/typed-confirm-modal'
import { useMobileWalletSetup } from '@/features/wallet/useMobileWalletSetup'
import { TransactionError } from '@/features/wallet/useWalletMutation'
import { useSettings } from '@/components/settings-provider'
import { useTheme } from '@/components/theme-provider'
import { createStyles, fontSizes, spacing, type Colors } from '@/constants/theme'
import { USDC_DEVNET, USDC_MAINNET } from '@/constants/tokens'
import { useFarmQuery } from '@/features/farm/useFarmQuery'
import { usePolicyQuery } from '@/features/insurance/usePolicyQuery'
import { useWeatherOracleQuery } from '@/features/insurance/useWeatherOracleQuery'
import { wouldTrigger } from '@/features/insurance/types'
import { useConfigQuery } from '@/features/admin/useConfigQuery'
import { useVerifierSetQuery } from '@/features/admin/useVerifierSetQuery'
import { useOracleSetQuery } from '@/features/admin/useOracleSetQuery'
import { useUsdcBalanceQuery } from '@/features/admin/useUsdcBalanceQuery'
import { useSettlePolicy } from '@/features/admin/useSettlePolicy'
import { useWithdrawTreasury } from '@/features/admin/useWithdrawTreasury'
import { useSetRoles } from '@/features/admin/useSetRoles'
import { useAddOracle } from '@/features/admin/useAddOracle'
import { useRemoveOracle } from '@/features/admin/useRemoveOracle'
import { useReconfigureVerifierSet } from '@/features/admin/useReconfigureVerifierSet'
import { useReleaseVerifier } from '@/features/admin/useReleaseVerifier'
import { useSlashVerifier } from '@/features/admin/useSlashVerifier'
import { useInitVerifierSet } from '@/features/admin/useInitVerifierSet'
import { useInitOracleSet } from '@/features/admin/useInitOracleSet'
import { useAdminStatus, useAllowlistUpdate } from '@/features/admin/adminApi'
import type { AdminStatus, AllowlistUpdate } from '@/features/admin/adminApi'
import {
  addressValidationError,
  validateInitOracleSet,
  validateOracleMember,
  validateSetRoles,
  validateSettlePolicy,
  validateVerifierSet,
  validateWithdrawTreasury,
} from '@/features/admin/types'
import { formatShortDate, formatUsdc, fromE6, shortenAddress, toE6 } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { ataPda, insuranceVaultPda, treasuryPda } from '@/lib/program'

/* ── Local form state ──────────────────────────────────────────────────────── */

interface FormState {
  /** Chain-seeded fields: `null` = untouched (displays the on-chain value). */
  admin: string | null
  verifier: string | null
  oracle: string | null
  withdraw: string
  reader: string
  reconfigK: string | null
  reconfigBond: string | null
  initVk: string
  initBond: string
  initOk: string
  entry: string
}

const EMPTY_FORM: FormState = {
  admin: null,
  verifier: null,
  oracle: null,
  withdraw: '',
  reader: '',
  reconfigK: null,
  reconfigBond: null,
  initVk: '',
  initBond: '',
  initOk: '',
  entry: '',
}

interface PendingConfirm {
  title: string
  description: string
  /** Exact text to type to arm the button; `null` = one-tap confirm. */
  phrase: string | null
  run: () => Promise<unknown>
}

/** Wallet-facing error text: mutation label + the real cause when present. */
function errMsg(e: unknown): string {
  if (e instanceof TransactionError) {
    const cause = e.cause instanceof Error ? e.cause.message : ''
    return cause && cause !== e.message ? `${e.message} — ${cause}` : e.message
  }
  return e instanceof Error ? e.message : String(e)
}

export default function AdminSettingsScreen() {
  const { address } = useMobileWalletSetup()
  const { network } = useSettings()
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const t = useT()

  /* ── Chain reads ─────────────────────────────────────────────────────────── */
  const configQuery = useConfigQuery()
  const config = configQuery.config
  const isAdmin = !!address && !!config && config.admin === address

  const farmQuery = useFarmQuery()
  const farm = farmQuery.farm
  const farmAddress = farmQuery.farmAddress
  const policyQuery = usePolicyQuery(farm && farmAddress ? { farmAddress, policyCount: farm.policyCount } : null)
  const policy = policyQuery.policy
  const oracleQuery = useWeatherOracleQuery(
    policy && farmAddress ? { farmAddress, seasonStart: policy.seasonStart } : null,
  )
  const verifierQuery = useVerifierSetQuery()
  const oracleSetQuery = useOracleSetQuery()

  const mint = network.cluster === 'mainnet' ? USDC_MAINNET : USDC_DEVNET
  const treasuryAtaQuery = useQuery({
    queryKey: ['indorse', 'treasury-ata', mint],
    queryFn: async () => {
      const treasury = await treasuryPda()
      return ataPda(treasury, mint)
    },
  })
  const treasuryBalance = useUsdcBalanceQuery(treasuryAtaQuery.data ?? null)

  const vaultQuery = useQuery({
    queryKey: ['indorse', 'policy-vault', farmAddress ?? null, farm?.policyCount ?? 0],
    enabled: !!farmAddress && !!farm && farm.policyCount > 0,
    queryFn: () => insuranceVaultPda(farmAddress as string, (farm as { policyCount: number }).policyCount - 1),
  })
  const vaultBalance = useUsdcBalanceQuery(vaultQuery.data ?? null)

  /* ── Actions ─────────────────────────────────────────────────────────────── */
  const settle = useSettlePolicy()
  const withdraw = useWithdrawTreasury()
  const setRoles = useSetRoles()
  const addOracle = useAddOracle()
  const removeOracle = useRemoveOracle()
  const reconfigure = useReconfigureVerifierSet()
  const release = useReleaseVerifier()
  const slash = useSlashVerifier()
  const initVerifier = useInitVerifierSet()
  const initOracle = useInitOracleSet()
  const apiStatus = useAdminStatus()
  const allowlist = useAllowlistUpdate()

  /* ── Page state ──────────────────────────────────────────────────────────── */
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({})
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const [executing, setExecuting] = useState(false)
  const [lastResult, setLastResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [status, setStatus] = useState<AdminStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  // Snapshot at mount (the repo's pattern — farms.tsx / EscrowCard): season
  // ends are day-scale, so a mount-time clock is as good as a live one.
  const [nowSec] = useState(() => Math.floor(Date.now() / 1000))

  const setField = (name: keyof FormState, value: string) => {
    setForm((f) => ({ ...f, [name]: value }))
    setErrors((e) => ({ ...e, [name]: undefined }))
  }

  /**
   * Display value for a form field: an edit always wins; an untouched field
   * shows the live on-chain value (config PDA / verifier set). Deriving this
   * instead of seeding state in an effect means an invalidated query shows
   * fresh data the moment it lands, while typed edits survive re-renders.
   */
  const displayValue = (name: keyof FormState): string => {
    const current = form[name]
    if (current !== null) return current
    switch (name) {
      case 'admin':
        return config?.admin ?? ''
      case 'verifier':
        return config?.verifier ?? ''
      case 'oracle':
        return config?.oracle ?? ''
      case 'reconfigK':
        return verifierSet ? String(verifierSet.k) : ''
      case 'reconfigBond':
        return verifierSet ? String(fromE6(verifierSet.bondAmount)) : ''
      default:
        return ''
    }
  }

  const ask = (title: string, description: string, phrase: string | null, run: () => Promise<unknown>) => {
    setLastResult(null)
    setPending({ title, description, phrase, run })
  }

  const confirmRun = async () => {
    if (!pending) return
    setExecuting(true)
    try {
      await pending.run()
      setLastResult({ ok: true, text: t('admin.txOk') })
    } catch (e) {
      setLastResult({ ok: false, text: errMsg(e) })
    } finally {
      setExecuting(false)
      setPending(null)
    }
  }

  /* ── Form submit helpers ─────────────────────────────────────────────────── */

  const submitRoles = () => {
    const input = {
      admin: displayValue('admin'),
      verifier: displayValue('verifier'),
      oracle: displayValue('oracle'),
    }
    const found = validateSetRoles(input)
    setErrors(found ? { admin: found.admin, verifier: found.verifier, oracle: found.oracle } : {})
    if (found) return
    ask(t('admin.confirmSetRoles'), t('admin.confirmSetRolesDesc'), 'set_roles', () => setRoles.mutateAsync(input))
  }

  const submitWithdraw = () => {
    const amountUsdc = Number(form.withdraw.trim())
    const found = validateWithdrawTreasury({ amountUsdc })
    setErrors(found ? { withdraw: found.amountUsdc } : {})
    if (found) return
    ask(t('admin.confirmWithdraw'), t('admin.confirmWithdrawDesc'), 'withdraw_treasury', () =>
      withdraw.mutateAsync({ amountUsdc }),
    )
  }

  const submitSettle = () => {
    if (!policy || !farmAddress) return
    const input = {
      farmAddress,
      farmerAddress: policy.farmer,
      policyCount: farm?.policyCount ?? 0,
      seasonStart: policy.seasonStart,
    }
    const found = validateSettlePolicy(input)
    if (found) {
      setLastResult({ ok: false, text: Object.values(found).filter(Boolean).join('; ') })
      return
    }
    ask(t('admin.confirmSettle'), t('admin.confirmSettleDesc'), 'settle_policy', () => settle.mutateAsync(input))
  }

  const submitReader = () => {
    const input = { member: form.reader }
    const found = validateOracleMember(input)
    setErrors(found ? { reader: found.member } : {})
    if (found) return
    ask(t('admin.confirmAddReader'), t('admin.confirmAddReaderDesc'), null, async () => {
      await addOracle.mutateAsync(input)
      setField('reader', '')
    })
  }

  const submitReconfigure = () => {
    const input = {
      k: Number(displayValue('reconfigK').trim()),
      bondAmount: Number(displayValue('reconfigBond').trim()),
    }
    const found = validateVerifierSet(input)
    setErrors(found ? { reconfigK: found.k, reconfigBond: found.bondAmount } : {})
    if (found) return
    ask(t('admin.confirmReconfigure'), t('admin.confirmReconfigureDesc'), null, () => reconfigure.mutateAsync(input))
  }

  const submitInitVerifier = () => {
    const input = { k: Number(form.initVk.trim()), bondAmount: Number(form.initBond.trim()) }
    const found = validateVerifierSet(input)
    setErrors(found ? { initVk: found.k, initBond: found.bondAmount } : {})
    if (found) return
    ask(t('admin.confirmInitVerifier'), t('admin.confirmInitVerifierDesc'), null, () => initVerifier.mutateAsync(input))
  }

  const submitInitOracle = () => {
    const input = { k: Number(form.initOk.trim()) }
    const found = validateInitOracleSet(input)
    setErrors(found ? { initOk: found.k } : {})
    if (found) return
    ask(t('admin.confirmInitOracle'), t('admin.confirmInitOracleDesc'), null, () => initOracle.mutateAsync(input))
  }

  /* ── API admin ───────────────────────────────────────────────────────────── */

  const refreshStatus = async () => {
    setStatusError(null)
    try {
      setStatus(await apiStatus.mutateAsync())
    } catch (e) {
      setStatusError(errMsg(e))
    }
  }

  const applyAllowlist = async (op: AllowlistUpdate) => {
    setStatusError(null)
    try {
      const result = await allowlist.mutateAsync(op)
      setStatus((s) => (s ? { ...s, allowlist: { entries: result.entries, source: result.source } } : s))
      setLastResult({ ok: true, text: t('admin.txOk') })
    } catch (e) {
      setLastResult({ ok: false, text: errMsg(e) })
    }
  }

  const submitEntry = () => {
    const entry = form.entry.trim()
    const problem = addressValidationError(entry)
    setErrors(entry ? { entry: problem } : {})
    if (problem) return
    ask(t('admin.confirmAddEntry'), t('admin.confirmAddEntryDesc'), null, async () => {
      await applyAllowlist({ add: [entry] })
      setField('entry', '')
    })
  }

  /* ── Shared bits ─────────────────────────────────────────────────────────── */

  const inputProps = (name: keyof FormState, placeholder: string, numeric = false) => ({
    value: displayValue(name),
    onChangeText: (v: string) => setField(name, v),
    placeholder,
    placeholderTextColor: colors.textDim,
    autoCapitalize: 'none' as const,
    autoCorrect: false,
    keyboardType: (numeric ? 'numeric' : 'default') as 'numeric' | 'default',
    accessibilityLabel: placeholder,
    style: styles.input,
  })

  const fieldError = (name: keyof FormState) =>
    errors[name] ? <Text style={styles.fieldError}>{errors[name]}</Text> : null

  const resultNote =
    lastResult === null ? null : (
      <SettingsNote>
        <Text style={lastResult.ok ? styles.resultOk : styles.resultErr}>{lastResult.text}</Text>
      </SettingsNote>
    )

  /* ── Gating ──────────────────────────────────────────────────────────────── */

  if (configQuery.state === 'loading') {
    return (
      <SettingsScreen title={t('admin.title')} subtitle={t('admin.subtitle')}>
        <SettingsNote>{t('admin.loading')}</SettingsNote>
      </SettingsScreen>
    )
  }

  if (!isAdmin) {
    return (
      <SettingsScreen title={t('admin.title')} subtitle={t('admin.subtitle')}>
        <SettingsGroup label={t('admin.gIdentity')}>
          <SettingRow
            title={t('admin.yourWallet')}
            description={address ? shortenAddress(address, 8) : t('profile.notConnected')}
          />
          <SettingRow title={t('admin.role')} description={t('admin.roleNone')} last />
        </SettingsGroup>
        <SettingsNote>{t('admin.locked')}</SettingsNote>
        {configQuery.state === 'error' ? <SettingsNote>{t('admin.configError')}</SettingsNote> : null}
      </SettingsScreen>
    )
  }

  /* ── Settlement readiness (the live pre-demo checklist) ──────────────────── */
  const seasonEnded = policy ? nowSec >= policy.seasonEnd : false
  const reading = oracleQuery.reading
  const finalized = reading?.finalized ?? false
  const coverage = policy ? fromE6(policy.coverageUsdc) : 0
  const vaultBal = vaultBalance.balance
  const funded = vaultBal !== null && policy !== null && vaultBal + 1e-9 >= coverage
  const shortfall = policy && vaultBal !== null ? Math.max(0, coverage - vaultBal) : coverage
  const canSettle = policy?.state === 'active' && seasonEnded && finalized
  const triggerPreview =
    policy && reading && finalized && reading.totalRainfallMm > 0 ? wouldTrigger(policy, reading.totalRainfallMm) : null

  const verifierSet = verifierQuery.set
  const oracleSet = oracleSetQuery.set

  return (
    <SettingsScreen title={t('admin.title')} subtitle={t('admin.subtitle')}>
      {/* ── Identity ─────────────────────────────────────────────────────── */}
      <SettingsGroup label={t('admin.gIdentity')}>
        <SettingRow title={t('admin.yourWallet')} description={address ? shortenAddress(address, 8) : '—'} />
        <SettingRow title={t('admin.role')} description={config ? shortenAddress(config.admin, 8) : '—'} last />
      </SettingsGroup>

      {/* ── Roles ────────────────────────────────────────────────────────── */}
      <SettingsGroup label={t('admin.gRoles')}>
        <SettingRow title={t('admin.roleAdminLabel')} description={config ? shortenAddress(config.admin, 8) : '—'} />
        <SettingRow
          title={t('admin.roleVerifierLabel')}
          description={config ? shortenAddress(config.verifier, 8) : '—'}
        />
        <SettingRow title={t('admin.roleOracleLabel')} description={config ? shortenAddress(config.oracle, 8) : '—'} />
        <View style={styles.formBox}>
          <TextInput {...inputProps('admin', t('admin.phAdmin'))} />
          {fieldError('admin')}
          <TextInput {...inputProps('verifier', t('admin.phVerifier'))} />
          {fieldError('verifier')}
          <TextInput {...inputProps('oracle', t('admin.phOracle'))} />
          {fieldError('oracle')}
          <SettingsButton label={t('admin.rotateRoles')} tone="secondary" onPress={submitRoles} />
        </View>
      </SettingsGroup>

      {/* ── Treasury ─────────────────────────────────────────────────────── */}
      <SettingsGroup label={t('admin.gTreasury')}>
        <SettingRow
          title={t('admin.treasuryBalance')}
          description={
            treasuryBalance.balance === null ? t('admin.vaultMissing') : formatUsdc(toE6(treasuryBalance.balance))
          }
        />
        <View style={styles.formBox}>
          <TextInput {...inputProps('withdraw', t('admin.phAmount'), true)} />
          {fieldError('withdraw')}
          <SettingsButton label={t('admin.withdraw')} tone="danger" onPress={submitWithdraw} />
        </View>
      </SettingsGroup>

      {/* ── Settlement ───────────────────────────────────────────────────── */}
      <SettingsGroup label={t('admin.gSettlement')}>
        {!policy ? (
          <SettingRow title={t('admin.noPolicy')} last />
        ) : (
          <>
            <SettingRow title={t('admin.policyState')} description={policy.state} />
            <SettingRow title={t('admin.seasonEnd')} description={formatShortDate(policy.seasonEnd)} />
            <SettingRow
              title={t('admin.oracleStatus')}
              description={finalized ? t('admin.oracleFinalized') : t('admin.oraclePending')}
            />
            <SettingRow
              title={t('admin.rainfall')}
              description={
                reading && reading.totalRainfallMm > 0
                  ? `${(reading.totalRainfallMm / 10).toFixed(0)} mm${
                      triggerPreview === null
                        ? ''
                        : ` — ${triggerPreview ? t('admin.wouldPay') : t('admin.wouldNotPay')}`
                    }`
                  : '—'
              }
            />
            <SettingRow
              title={t('admin.threshold')}
              description={`${(policy.triggerThresholdMm / 10).toFixed(0)} mm`}
            />
            <SettingRow
              title={t('admin.vaultBalance')}
              description={
                vaultBal === null
                  ? t('admin.vaultUnfunded')
                  : funded
                    ? t('admin.vaultFunded')
                    : t('admin.vaultShort', { amount: formatUsdc(toE6(shortfall)) })
              }
              last
            />
            <View style={styles.formBox}>
              {!canSettle ? <SettingsNote>{t('admin.settleWaiting')}</SettingsNote> : null}
              {!funded ? <SettingsNote>{t('admin.vaultWarn')}</SettingsNote> : null}
              <SettingsButton label={t('admin.settle')} tone="primary" onPress={submitSettle} disabled={!canSettle} />
            </View>
          </>
        )}
      </SettingsGroup>

      {/* ── Oracle seats ─────────────────────────────────────────────────── */}
      <SettingsGroup label={t('admin.gOracle')}>
        {!oracleSet ? (
          <View style={styles.formBox}>
            <SettingsNote>{t('admin.noOracleSet')}</SettingsNote>
            <TextInput {...inputProps('initOk', t('admin.phK'), true)} />
            {fieldError('initOk')}
            <SettingsButton label={t('admin.initOracleSet')} tone="secondary" onPress={submitInitOracle} />
          </View>
        ) : (
          <>
            <SettingRow title={t('admin.oracleK')} description={String(oracleSet.k)} />
            {oracleSet.members.length === 0 ? (
              <SettingRow title={t('admin.noMembers')} />
            ) : (
              oracleSet.members.map((member, i) => (
                <SettingRow
                  key={member}
                  title={shortenAddress(member, 6)}
                  description={t('admin.readerSeat')}
                  last={i === oracleSet.members.length - 1}
                >
                  <Pressable
                    style={styles.chipDanger}
                    accessibilityRole="button"
                    accessibilityLabel={t('admin.remove')}
                    onPress={() =>
                      ask(t('admin.confirmRemoveReader'), t('admin.confirmRemoveReaderDesc'), null, async () => {
                        await removeOracle.mutateAsync({ member })
                        setLastResult({ ok: true, text: t('admin.txOk') })
                      })
                    }
                  >
                    <Text style={styles.chipDangerText}>{t('admin.remove')}</Text>
                  </Pressable>
                </SettingRow>
              ))
            )}
            <View style={styles.formBox}>
              <TextInput {...inputProps('reader', t('admin.phReader'))} />
              {fieldError('reader')}
              <SettingsButton label={t('admin.addReader')} tone="secondary" onPress={submitReader} />
            </View>
          </>
        )}
      </SettingsGroup>

      {/* ── Verifier seats ───────────────────────────────────────────────── */}
      <SettingsGroup label={t('admin.gVerifier')}>
        {!verifierSet ? (
          <View style={styles.formBox}>
            <SettingsNote>{t('admin.noVerifierSet')}</SettingsNote>
            <TextInput {...inputProps('initVk', t('admin.phK'), true)} />
            {fieldError('initVk')}
            <TextInput {...inputProps('initBond', t('admin.phBond'), true)} />
            {fieldError('initBond')}
            <SettingsButton label={t('admin.initVerifierSet')} tone="secondary" onPress={submitInitVerifier} />
          </View>
        ) : (
          <>
            <SettingRow title={t('admin.verifierK')} description={String(verifierSet.k)} />
            <SettingRow title={t('admin.verifierBond')} description={formatUsdc(verifierSet.bondAmount)} />
            {verifierSet.members.map((member, i) => (
              <SettingRow
                key={member.pubkey}
                title={shortenAddress(member.pubkey, 6)}
                description={formatUsdc(member.stake)}
                last={i === verifierSet.members.length - 1 && form.reconfigK === ''}
              >
                <Pressable
                  style={styles.chip}
                  accessibilityRole="button"
                  accessibilityLabel={t('admin.release')}
                  onPress={() =>
                    ask(t('admin.confirmRelease'), t('admin.confirmReleaseDesc'), null, async () => {
                      await release.mutateAsync({ target: member.pubkey })
                      setLastResult({ ok: true, text: t('admin.txOk') })
                    })
                  }
                >
                  <Text style={styles.chipText}>{t('admin.release')}</Text>
                </Pressable>
                <Pressable
                  style={styles.chipDanger}
                  accessibilityRole="button"
                  accessibilityLabel={t('admin.slash')}
                  onPress={() =>
                    ask(t('admin.confirmSlash'), t('admin.confirmSlashDesc'), 'slash_verifier', async () => {
                      await slash.mutateAsync({ target: member.pubkey })
                      setLastResult({ ok: true, text: t('admin.txOk') })
                    })
                  }
                >
                  <Text style={styles.chipDangerText}>{t('admin.slash')}</Text>
                </Pressable>
              </SettingRow>
            ))}
            <View style={styles.formBox}>
              <TextInput {...inputProps('reconfigK', t('admin.phK'), true)} />
              {fieldError('reconfigK')}
              <TextInput {...inputProps('reconfigBond', t('admin.phBond'), true)} />
              {fieldError('reconfigBond')}
              <SettingsButton label={t('admin.reconfigure')} tone="secondary" onPress={submitReconfigure} />
            </View>
          </>
        )}
      </SettingsGroup>

      {/* ── API admin ────────────────────────────────────────────────────── */}
      <SettingsGroup label={t('admin.gApi')}>
        <SettingRow title={t('admin.apiIntro')} last>
          <Text style={styles.badge}>{status ? `${status.allowlist.entries.length}` : '—'}</Text>
        </SettingRow>
        <View style={styles.formBox}>
          <SettingsButton
            label={t('admin.refreshStatus')}
            tone="secondary"
            onPress={() => void refreshStatus()}
            busy={apiStatus.isPending}
          />
          {status ? (
            <>
              <SettingRow
                title={t('admin.apiEmail')}
                description={status.api.email ? t('admin.configured') : t('admin.notConfigured')}
              />
              <SettingRow
                title={t('admin.apiSas')}
                description={status.api.sas ? t('admin.configured') : t('admin.notConfigured')}
              />
              <SettingRow
                title={t('admin.apiAi')}
                description={status.api.ai ? t('admin.configured') : t('admin.notConfigured')}
                last
              />
              <SettingsNote>
                {t('admin.allowlist', { count: status.allowlist.entries.length })} ·{' '}
                {status.allowlist.source === 'runtime'
                  ? t('admin.allowlistSourceRuntime')
                  : t('admin.allowlistSourceEnv')}
              </SettingsNote>
              {status.allowlist.entries.length === 0 ? (
                <SettingsNote>{t('admin.emptyAllowlist')}</SettingsNote>
              ) : (
                status.allowlist.entries.map((entry) => (
                  <SettingRow key={entry} title={shortenAddress(entry, 6)} last>
                    <Pressable
                      style={styles.chipDanger}
                      accessibilityRole="button"
                      accessibilityLabel={t('admin.remove')}
                      onPress={() =>
                        ask(t('admin.confirmRemoveEntry'), t('admin.confirmRemoveEntryDesc'), null, async () => {
                          await applyAllowlist({ remove: [entry] })
                        })
                      }
                    >
                      <Text style={styles.chipDangerText}>{t('admin.remove')}</Text>
                    </Pressable>
                  </SettingRow>
                ))
              )}
              <TextInput {...inputProps('entry', t('admin.phEntry'))} />
              {fieldError('entry')}
              <SettingsButton
                label={t('admin.addEntry')}
                tone="secondary"
                onPress={submitEntry}
                busy={allowlist.isPending}
              />
            </>
          ) : (
            <SettingsNote>{t('admin.noStatus')}</SettingsNote>
          )}
          {statusError ? (
            <SettingsNote>
              <Text style={styles.resultErr}>{statusError}</Text>
            </SettingsNote>
          ) : null}
        </View>
      </SettingsGroup>

      {resultNote}

      <TypedConfirmModal
        visible={pending !== null}
        title={pending?.title ?? ''}
        description={pending?.description}
        phrase={pending?.phrase ?? null}
        confirmLabel={t('admin.confirm')}
        busy={executing}
        onCancel={() => setPending(null)}
        onConfirm={() => void confirmRun()}
      />
    </SettingsScreen>
  )
}

const makeStyles = (colors: Colors) =>
  createStyles({
    formBox: {
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
    fieldError: {
      fontSize: fontSizes.sm,
      color: colors.dangerText,
      marginTop: -spacing.xs,
    },
    chip: {
      borderWidth: 1,
      borderColor: colors.borderMid,
      backgroundColor: colors.surfaceAlt,
      borderRadius: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
    },
    chipText: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xxs,
      color: colors.textSecondary,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    chipDanger: {
      borderWidth: 1,
      borderColor: `${colors.danger}66`,
      backgroundColor: `${colors.danger}14`,
      borderRadius: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
    },
    chipDangerText: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xxs,
      color: colors.dangerText,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    badge: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xs,
      color: colors.textSecondary,
      letterSpacing: 0.6,
    },
    resultOk: {
      color: colors.sageLight,
    },
    resultErr: {
      color: colors.dangerText,
    },
  })
