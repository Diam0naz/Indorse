/**
 * components/assistant-sheet.tsx — the "Ask indorse" guide
 *
 * A slide-up chat against `POST /api/assistant`: the farmer asks anything
 * about the app, the grounded model answers from one hand-written knowledge
 * document (see `api/_lib/knowledge.ts`) — explain-only, never moving money.
 *
 * What makes the answer about THIS screen and THIS farm: the sheet sends a
 * small, honest context block assembled from the same chain queries the
 * Weather screen reads — route, farm existence/name, and the active policy
 * (cover, trigger, finalized rainfall). Every field is optional server-side
 * and omitted while still loading: a partial context beats a stale one.
 *
 * `initialQuestion` (from the help chip's screen) auto-sends once the
 * context has settled or a short gate timer fires — the first answer
 * arrives without making the farmer type. Failures render as one honest
 * line (`not configured` / `rate limited` / generic) — the thread keeps
 * whatever already succeeded.
 *
 * Every bubble carries a small copy icon in its bottom corner: one tap
 * puts that message on the clipboard and the glyph flips to a check (the
 * app's usual sage confirmation) for a beat before reverting. While a
 * reply is on its way the "Thinking…" line carries the guide's robot
 * head, turning one revolution in three uneven beats — deliberately out
 * of step, never a metronomic loop.
 *
 * A failed ask keeps its question bubble and renders the honest error
 * line with a small retry icon beside it — one tap re-asks the same
 * question without duplicating it. The not-configured error offers no
 * retry, since none could help. The error belongs to that turn: asking
 * a later question never clears an earlier one's error line, so a
 * question can never sit on screen unanswered with no way to retry it.
 */

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { usePathname } from 'expo-router'
import Clipboard from '@react-native-clipboard/clipboard'
import Svg, { Path, Rect } from 'react-native-svg'
import { RobotHeadIcon } from '@/components/robot-head-icon'
import { useTheme } from '@/components/theme-provider'
import { createStyles, fontSizes, fontWeights, radii, spacing, type Colors } from '@/constants/theme'
import { ClassificationError } from '@/features/ai/types'
import { askAssistant, MAX_MESSAGE_CHARS, type AssistantContext } from '@/features/assistant/askAssistant'
import { useFarmQuery } from '@/features/farm/useFarmQuery'
import { usePolicyQuery } from '@/features/insurance/usePolicyQuery'
import { useWeatherOracleQuery } from '@/features/insurance/useWeatherOracleQuery'
import { useI18n } from '@/lib/i18n'

export interface AssistantSheetProps {
  /** Asked automatically when the sheet opens — the chip's screen question. */
  initialQuestion?: string
  onClose: () => void
}

interface Turn {
  role: 'user' | 'assistant'
  text: string
  /**
   * Set when THIS question's ask failed, and cleared when it finally lands.
   * The failure belongs to its own turn: a single global error slot meant
   * asking a second question wiped the first one's error, leaving that
   * question on screen answered by nothing and with no way to retry it.
   */
  failed?: SheetError
}

type SheetError = 'assist.err.notConfigured' | 'assist.err.rate' | 'assist.err.generic'

/** How long the auto-send waits for chain context before sending without it. */
const CONTEXT_GATE_MS = 1200

export function AssistantSheet({ initialQuestion, onClose }: AssistantSheetProps) {
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const { t, lang } = useI18n()
  const insets = useSafeAreaInsets()

  // The same chain reads the Weather screen uses — best-effort context.
  const pathname = usePathname()
  const farmQuery = useFarmQuery()
  const farm = farmQuery.farm
  const policyQuery = usePolicyQuery(
    farm && farmQuery.farmAddress ? { farmAddress: farmQuery.farmAddress, policyCount: farm.policyCount } : null,
  )
  const policy = policyQuery.policy
  const oracleQuery = useWeatherOracleQuery(
    policy && farmQuery.farmAddress ? { farmAddress: farmQuery.farmAddress, seasonStart: policy.seasonStart } : null,
  )
  const reading = oracleQuery.reading

  // Context is only truthful when the reads have settled — while a query
  // is still loading the field is omitted instead of guessed.
  const settled = farmQuery.state !== 'loading' && (farm === null || policyQuery.state !== 'loading')
  const context: AssistantContext = useMemo(() => {
    const policyBlock = policy
      ? {
          status: policy.state,
          coverUsdc: policy.coverageUsdc / 1_000_000,
          triggerMm: policy.triggerThresholdMm / 10,
          // An unfrozen oracle reading is not a fact — leave it out.
          ...(reading?.finalized ? { totalMm: reading.totalRainfallMm / 10 } : {}),
        }
      : null
    return {
      route: pathname,
      ...(settled ? { hasFarm: farm !== null } : {}),
      ...(settled && farm?.name ? { farmName: farm.name } : {}),
      policy: policyBlock,
    }
  }, [pathname, settled, farm, policy, reading])

  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const startedRef = useRef(false)
  const gateRef = useRef(false)
  const threadRef = useRef<ScrollView>(null)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The check reverts after a beat; never leave a timer ticking past unmount.
  useEffect(
    () => () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    },
    [],
  )

  /** Copy one turn to the clipboard and show the check on its icon. */
  function copyTurn(index: number, text: string) {
    Clipboard.setString(text)
    setCopiedIndex(index)
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    copyTimerRef.current = setTimeout(() => setCopiedIndex(null), 1500)
  }

  /**
   * The ask itself. A failure is recorded on the turn it belongs to rather
   * than in one shared slot, so an earlier question keeps its own error line
   * and retry icon after later questions succeed.
   */
  async function ask(turnIndex: number, message: string) {
    setBusy(true)
    try {
      const result = await askAssistant(message, { lang, context })
      setTurns((prev) => {
        const next = [...prev]
        const own = next[turnIndex]
        if (own?.role === 'user') next[turnIndex] = { ...own, failed: undefined }
        next.push({ role: 'assistant', text: result.reply })
        return next
      })
    } catch (caught) {
      const failed = errorKeyFor(caught)
      setTurns((prev) => {
        const own = prev[turnIndex]
        if (!own || own.role !== 'user') return prev
        const next = [...prev]
        next[turnIndex] = { ...own, failed }
        return next
      })
    } finally {
      setBusy(false)
    }
  }

  /** One question → user bubble → assistant bubble (or that turn's honest error). */
  function send(raw: string) {
    const message = raw.trim().slice(0, MAX_MESSAGE_CHARS)
    if (message.length === 0 || busy) return
    // Turns only ever grow by one here, so this is the index of the question
    // being asked — the slot its reply or error belongs to.
    const turnIndex = turns.length
    setTurns((prev) => [...prev, { role: 'user', text: message }])
    setInput('')
    void ask(turnIndex, message)
  }

  /** Re-ask one failed question — same bubble, never a duplicate. */
  function retry(turnIndex: number) {
    const turn = turns[turnIndex]
    if (busy || !turn || turn.role !== 'user') return
    void ask(turnIndex, turn.text)
  }

  // The chip's question goes out once the context has settled — or after a
  // short gate, so a guest with no wallet is never left waiting on a query
  // that will never run.
  useEffect(() => {
    if (settled) {
      gateRef.current = true
      return
    }
    const timer = setTimeout(() => {
      gateRef.current = true
    }, CONTEXT_GATE_MS)
    return () => clearTimeout(timer)
  }, [settled])

  useEffect(() => {
    if (!initialQuestion || startedRef.current || !gateRef.current || busy || turns.length > 0) return
    startedRef.current = true
    void send(initialQuestion)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion, busy, turns.length])

  // Keep the newest turn in view.
  useEffect(() => {
    if (turns.length > 0) threadRef.current?.scrollToEnd({ animated: false })
  }, [turns.length])

  return (
    <Modal visible animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
          <View style={styles.headerMain}>
            <Text style={styles.title}>{t('assist.title')}</Text>
            <Text style={styles.welcome}>{t('assist.welcome')}</Text>
          </View>
          <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={8} accessibilityLabel={t('scout.cam.close')}>
            <Text style={styles.closeText}>×</Text>
          </Pressable>
        </View>

        {/*
          Android: the sheet lives in a Modal window, which the activity's
          adjustResize never reaches — with no behavior here the keyboard
          simply covered the input row. 'height' shrinks the pane instead,
          so the composer rides above the keyboard on both platforms.
        */}
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView
            ref={threadRef}
            contentContainerStyle={styles.thread}
            keyboardShouldPersistTaps="handled"
            accessibilityLabel={t('assist.title')}
          >
            {turns.map((turn, index) => {
              const mine = turn.role === 'user'
              const copied = copiedIndex === index
              return (
                <Fragment key={`${turn.role}-${index}`}>
                  <View style={[styles.bubble, mine ? styles.bubbleUser : styles.bubbleReply]}>
                    <Text style={mine ? styles.userText : styles.replyText}>{turn.text}</Text>
                    <Pressable
                      style={styles.copyBtn}
                      onPress={() => copyTurn(index, turn.text)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={copied ? t('assist.copied') : t('assist.copy')}
                    >
                      {copied ? (
                        <CheckGlyph fg={colors.sage} />
                      ) : (
                        <CopyGlyph fg={colors.textDim} bg={mine ? colors.surfaceAlt : colors.surface} />
                      )}
                    </Pressable>
                  </View>
                  {mine && turn.failed ? (
                    <View style={styles.errorRow}>
                      <Text style={styles.error} accessibilityRole="alert">
                        {t(turn.failed)}
                      </Text>
                      {turn.failed !== 'assist.err.notConfigured' ? (
                        <Pressable
                          style={styles.retryBtn}
                          onPress={() => retry(index)}
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel={t('assist.retry')}
                        >
                          <RotateGlyph fg={colors.amber} />
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}
                </Fragment>
              )
            })}
            {busy ? (
              <View style={styles.thinking}>
                <Text style={styles.thinkingText}>{t('assist.thinking')}</Text>
                <ThinkingRobot color={colors.textDim} />
              </View>
            ) : null}
          </ScrollView>

          <View style={[styles.inputRow, { paddingBottom: insets.bottom + spacing.sm }]}>
            <TextInput
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder={t('assist.placeholder')}
              placeholderTextColor={colors.textDim}
              editable={!busy}
              maxLength={MAX_MESSAGE_CHARS}
              onSubmitEditing={() => send(input)}
              returnKeyType="send"
              accessibilityLabel={t('assist.placeholder')}
            />
            <Pressable
              style={[styles.sendBtn, (busy || input.trim().length === 0) && styles.sendDisabled]}
              onPress={() => send(input)}
              disabled={busy || input.trim().length === 0}
              accessibilityRole="button"
              accessibilityLabel={t('assist.send')}
            >
              <Text style={styles.sendText}>{t('assist.send')}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}

/** The copy glyph — two overlapping cards, the front one masked to the bubble. */
function CopyGlyph({ fg, bg }: { fg: string; bg: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 16 16" fill="none">
      <Rect x="5.75" y="5.75" width="8" height="8" rx="2" stroke={fg} strokeWidth="1.4" />
      <Rect x="2.5" y="2.5" width="8.5" height="8.5" rx="2" fill={bg} stroke={fg} strokeWidth="1.4" />
    </Svg>
  )
}

/** What the icon becomes for a beat after the copy lands. */
function CheckGlyph({ fg }: { fg: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 16 16" fill="none">
      <Path d="M3 8.5l3.4 3.4L13 4.9" stroke={fg} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

/** The retry glyph — a circular arrow: the guide trying the question again. */
function RotateGlyph({ fg }: { fg: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
      <Path
        d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"
        stroke={fg}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M23 4v6h-6" stroke={fg} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

/**
 * The guide's head turning while it thinks — one revolution in three uneven
 * beats with two short holds (fast ease-out, slow sine sweep, quick snap),
 * so the spin reads deliberately out of step instead of metronomic. The
 * turn count only climbs and each beat eases into the next, so cycles join
 * seamlessly; the effect stops itself when the reply lands.
 */
function ThinkingRobot({ color }: { color: string }) {
  // Lazy state, not a ref: the value is read during render (interpolate).
  const [spin] = useState(() => new Animated.Value(0))
  const runningRef = useRef<ReturnType<typeof Animated.sequence> | null>(null)

  useEffect(() => {
    let cancelled = false

    const runCycle = (start: number) => {
      if (cancelled) return
      const beat = (at: number, duration: number, easing: (t: number) => number) =>
        Animated.timing(spin, { toValue: start + at, duration, easing, useNativeDriver: true })
      const cycle = Animated.sequence([
        beat(0.39, 420, Easing.out(Easing.cubic)),
        Animated.delay(70),
        beat(0.8, 640, Easing.inOut(Easing.sin)),
        Animated.delay(150),
        beat(1, 300, Easing.in(Easing.cubic)),
      ])
      runningRef.current = cycle
      cycle.start(({ finished }) => {
        if (finished && !cancelled) runCycle(start + 1)
      })
    }

    runCycle(0)
    return () => {
      cancelled = true
      runningRef.current?.stop()
    }
  }, [spin])

  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
    extrapolate: 'extend',
  })
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <RobotHeadIcon color={color} size={16} />
    </Animated.View>
  )
}

/** Classify a thrown error into the sheet's three honest notes. */
function errorKeyFor(error: unknown): SheetError {
  if (error instanceof ClassificationError) {
    if (error.message.includes('not configured')) return 'assist.err.notConfigured'
    if (error.status === 429) return 'assist.err.rate'
  }
  return 'assist.err.generic'
}

const makeStyles = (colors: Colors) =>
  createStyles({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    flex: {
      flex: 1,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.md,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerMain: {
      flex: 1,
      paddingRight: spacing.md,
    },
    title: {
      fontSize: fontSizes.xl,
      fontWeight: fontWeights.bold,
      color: colors.textPrimary,
    },
    welcome: {
      fontSize: fontSizes.xs,
      color: colors.textMuted,
      marginTop: 2,
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
    thread: {
      padding: spacing.lg,
      gap: spacing.sm,
    },
    bubble: {
      maxWidth: '88%',
      borderRadius: radii.md,
      borderWidth: 1,
      padding: spacing.md,
    },
    bubbleUser: {
      alignSelf: 'flex-end',
      backgroundColor: colors.surfaceAlt,
      borderColor: colors.border,
    },
    bubbleReply: {
      alignSelf: 'flex-start',
      backgroundColor: colors.surface,
      borderColor: colors.borderMid,
    },
    copyBtn: {
      alignSelf: 'flex-end',
      marginTop: spacing.xs,
      padding: 2,
    },
    userText: {
      fontSize: fontSizes.base,
      color: colors.textPrimary,
      lineHeight: 20,
    },
    replyText: {
      fontSize: fontSizes.base,
      color: colors.textSecondary,
      lineHeight: 20,
    },
    thinking: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.xs,
    },
    thinkingText: {
      fontSize: fontSizes.sm,
      color: colors.textDim,
      fontStyle: 'italic',
    },
    error: {
      alignSelf: 'center',
      fontSize: fontSizes.sm,
      color: colors.dangerText,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      textAlign: 'center',
    },
    errorRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    retryBtn: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    inputRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.surface,
    },
    input: {
      flex: 1,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md - 2,
      fontSize: fontSizes.base,
      color: colors.textPrimary,
    },
    sendBtn: {
      justifyContent: 'center',
      paddingHorizontal: spacing.md,
      borderRadius: radii.md,
      backgroundColor: colors.amber,
    },
    sendDisabled: {
      opacity: 0.4,
    },
    sendText: {
      color: colors.surface,
      fontSize: fontSizes.sm,
      fontWeight: fontWeights.semibold,
    },
  })
