/**
 * app/onboarding.tsx — Onboarding Flow
 *
 * Logo splash (~1.5s) → 3 paged slides → "Welcome back" screen (centered).
 * Wallet connection is deliberately not part of onboarding — the user connects
 * from the Profile tab instead.
 */

import { Dimensions, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRef, useState, useEffect } from 'react'
import Svg, { Circle, Path } from 'react-native-svg'
import { router } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { IndorseMark, IndorseMarkSmall } from '@/components/IndorseMark'
import { useTheme } from '@/components/theme-provider'
import { createStyles, fontSizes, fontWeights, radii, spacing, type Colors } from '@/constants/theme'
import { useT, type MessageKey } from '@/lib/i18n'

const { width: SCREEN_WIDTH } = Dimensions.get('window')

const SPLASH_MS = 1500

/** splash → the 3 feature slides → the final "welcome back" screen */
type Phase = 'splash' | 'slides' | 'welcome'

interface SlideDef {
  id: number
  icon: 'crosshair' | 'camera' | 'trophy'
  accent: 'sage' | 'sky' | 'amber'
  tagKey: MessageKey
  titleKey: MessageKey
  bodyKey: MessageKey
}

const SLIDES: SlideDef[] = [
  { id: 1, icon: 'crosshair', accent: 'sage', tagKey: 'onb.s1.tag', titleKey: 'onb.s1.title', bodyKey: 'onb.s1.body' },
  { id: 2, icon: 'camera', accent: 'sky', tagKey: 'onb.s2.tag', titleKey: 'onb.s2.title', bodyKey: 'onb.s2.body' },
  { id: 3, icon: 'trophy', accent: 'amber', tagKey: 'onb.s3.tag', titleKey: 'onb.s3.title', bodyKey: 'onb.s3.body' },
]

export default function OnboardingScreen() {
  const [phase, setPhase] = useState<Phase>('splash')
  const [activeSlide, setActiveSlide] = useState(0)
  const scrollRef = useRef<ScrollView>(null)
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const t = useT()

  const isLastSlide = activeSlide === SLIDES.length - 1

  // Auto-hide splash after SPLASH_MS
  useEffect(() => {
    const timer = setTimeout(() => setPhase('slides'), SPLASH_MS)
    return () => clearTimeout(timer)
  }, [])

  function goToSlide(index: number) {
    scrollRef.current?.scrollTo({ x: index * SCREEN_WIDTH, animated: true })
    setActiveSlide(index)
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  }

  function handleNext() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    if (isLastSlide) {
      setPhase('welcome')
    } else {
      goToSlide(activeSlide + 1)
    }
  }

  function handleSkip() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setPhase('welcome')
  }

  function handleEnter() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    router.replace('/(tabs)')
  }

  // ── 1. Logo splash ──────────────────────────────────────────────
  if (phase === 'splash') {
    return (
      <SafeAreaView style={styles.splashContainer}>
        <View style={styles.splashContent}>
          <IndorseMark size={120} />
          <Text style={styles.splashName}>indorse</Text>
        </View>
      </SafeAreaView>
    )
  }

  // ── 3. "Welcome back" — vertically centered ─────────────────────
  if (phase === 'welcome') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.welcomeScreen}>
          <View style={styles.welcomeContent}>
            <IndorseMark size={96} />
            <Text style={styles.welcomeTitle}>{t('onb.welcome')}</Text>
            <Text style={styles.welcomeBody}>{t('onb.welcomeBody')}</Text>
          </View>
          <View style={styles.welcomeActions}>
            <TouchableOpacity
              style={styles.nextBtn}
              onPress={handleEnter}
              accessibilityRole="button"
              accessibilityLabel={t('onb.enter')}
            >
              <Text style={styles.nextText}>{t('onb.enter')}</Text>
              <Svg width={14} height={14} viewBox="0 0 14 14" fill="none">
                <Path
                  d="M3 7h8M8 4l3 3-3 3"
                  stroke={colors.surface}
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* ── Top bar ─────────────────────────────────────────────── */}
      <View style={styles.topBar}>
        <View style={styles.brand}>
          <View style={styles.brandTile}>
            <IndorseMarkSmall size={16} />
          </View>
          <Text style={styles.brandName}>indorse</Text>
        </View>
        <TouchableOpacity style={styles.skipBtn} onPress={handleSkip} hitSlop={10}>
          <Text style={styles.skipText}>{t('onb.skip')}</Text>
        </TouchableOpacity>
      </View>

      {/* ── 2. Feature slides (1-3) ───────────────────────────────── */}
      <View style={styles.contentNormal}>
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          onMomentumScrollEnd={(e) => {
            const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH)
            setActiveSlide(idx)
          }}
          style={styles.sliderNormal}
        >
          {SLIDES.map((slide) => (
            <SlideView key={slide.id} slide={slide} />
          ))}
        </ScrollView>

        {/* ── Pagination dots ───────────────────────────────────────── */}
        <View style={styles.dotsRow}>
          {SLIDES.map((slide, i) => (
            <TouchableOpacity key={slide.id} onPress={() => goToSlide(i)} hitSlop={8}>
              <View style={[styles.dot, i === activeSlide ? styles.dotActive : styles.dotInactive]} />
            </TouchableOpacity>
          ))}
        </View>

        {/* ── CTA (Next / Get started) ─────────────────────────────── */}
        <View style={styles.cta}>
          <TouchableOpacity
            style={styles.nextBtn}
            onPress={handleNext}
            accessibilityRole="button"
            accessibilityLabel={isLastSlide ? t('onb.getStarted') : t('onb.next')}
          >
            <Text style={styles.nextText}>{isLastSlide ? t('onb.getStarted') : t('onb.next')}</Text>
            <Svg width={14} height={14} viewBox="0 0 14 14" fill="none">
              <Path
                d="M3 7h8M8 4l3 3-3 3"
                stroke={colors.surface}
                strokeWidth={1.6}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  )
}

/* ── Slide sub-component ───────────────────────────────────────────── */

function SlideView({ slide }: { slide: SlideDef }) {
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const t = useT()
  const accent = colors[slide.accent]

  return (
    <View style={[styles.slide, { width: SCREEN_WIDTH }]}>
      <View style={styles.iconStage}>
        <View style={[styles.iconGlow, { borderColor: `${accent}22` }]} />
        <View style={[styles.iconTile, { borderColor: `${accent}66`, backgroundColor: `${accent}12` }]}>
          <SlideIcon kind={slide.icon} accent={accent} />
        </View>
      </View>

      <Text style={[styles.slideTag, { color: accent }]}>{t(slide.tagKey)}</Text>
      <Text style={styles.slideTitle}>{t(slide.titleKey)}</Text>
      <Text style={styles.slideSubtitle}>{t(slide.bodyKey)}</Text>
    </View>
  )
}

// Icon size constant for uniform sizing across all three slides
const ICON_SIZE = 48
const ICON_VIEWBOX = '0 0 24 24'

function SlideIcon({ kind, accent }: { kind: 'crosshair' | 'camera' | 'trophy'; accent: string }) {
  if (kind === 'camera') {
    return (
      <Svg width={ICON_SIZE} height={ICON_SIZE} viewBox={ICON_VIEWBOX} fill="none">
        <Path
          d="M3 7.5C3 6.4 3.9 5.5 5 5.5h.8L7.1 3.5h5.8L14.2 5.5H16c1.1 0 2 .9 2 2v8.5c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V7.5z"
          stroke={accent}
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
        <Circle cx={10.5} cy={11.5} r={3.2} stroke={accent} strokeWidth={1.5} />
      </Svg>
    )
  }

  if (kind === 'trophy') {
    return (
      <Svg width={ICON_SIZE} height={ICON_SIZE} viewBox={ICON_VIEWBOX} fill="none">
        {/* Trophy cup - shifted up slightly to prevent overflow */}
        <Path d="M7 5h10v4.5a5 5 0 0 1-10 0V5z" stroke={accent} strokeWidth={1.5} strokeLinejoin="round" />
        {/* Left handle */}
        <Path d="M7 6.5H4.5v1a3 3 0 0 0 3 3" stroke={accent} strokeWidth={1.5} strokeLinecap="round" />
        {/* Right handle */}
        <Path d="M17 6.5h2.5v1a3 3 0 0 1-3 3" stroke={accent} strokeWidth={1.5} strokeLinecap="round" />
        {/* Base - shortened to fit */}
        <Path
          d="M12 14.5v2.5M9 19.5h6M10 17h4l1.5 2.5h-7L10 17z"
          stroke={accent}
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
      </Svg>
    )
  }

  return (
    <Svg width={ICON_SIZE} height={ICON_SIZE} viewBox={ICON_VIEWBOX} fill="none">
      <Circle cx={12} cy={11} r={6} stroke={accent} strokeWidth={1.5} />
      <Path d="M12 4.5v-2M12 19.5v2M4 11H3M21 11h1" stroke={accent} strokeWidth={1.5} strokeLinecap="round" />
      <Circle cx={12} cy={11} r={1.8} fill={accent} />
      <Path d="M16.2 15.2L19.5 18.5" stroke={accent} strokeWidth={1.5} strokeLinecap="round" />
    </Svg>
  )
}

/* ── Styles ─────────────────────────────────────────────────────────── */

const makeStyles = (colors: Colors) =>
  createStyles({
    // Splash screen
    splashContainer: {
      flex: 1,
      backgroundColor: colors.bg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    splashContent: {
      alignItems: 'center',
      gap: spacing.lg,
    },
    splashName: {
      fontSize: fontSizes['4xl'],
      fontWeight: fontWeights.bold,
      color: colors.textPrimary,
      letterSpacing: -0.6,
    },

    // Main flow
    safe: {
      flex: 1,
      backgroundColor: colors.bg,
      alignItems: 'center',
    },
    topBar: {
      width: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.md,
    },
    brand: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
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
    brandName: {
      fontSize: fontSizes.lg,
      fontWeight: fontWeights.bold,
      color: colors.textPrimary,
    },
    skipBtn: {
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.sm,
    },
    skipText: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xs,
      color: colors.textMuted,
      letterSpacing: 1,
      textTransform: 'uppercase',
    },

    sliderNormal: {
      flex: 1,
      width: SCREEN_WIDTH,
    },
    slide: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing['2xl'],
    },
    iconStage: {
      width: 190,
      height: 190,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.xl,
    },
    iconGlow: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      borderRadius: 95,
      borderWidth: 1,
    },
    iconTile: {
      width: 128,
      height: 128,
      borderRadius: 38,
      borderWidth: 1.5,
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'center',
    },
    slideTag: {
      fontFamily: 'monospace',
      fontSize: fontSizes.xs,
      letterSpacing: 2,
      textTransform: 'uppercase',
      marginBottom: spacing.md,
    },
    slideTitle: {
      color: colors.textPrimary,
      fontSize: fontSizes['4xl'],
      fontWeight: fontWeights.bold,
      textAlign: 'center',
      letterSpacing: -0.6,
      marginBottom: spacing.md,
    },
    slideSubtitle: {
      color: colors.textSecondary,
      fontSize: fontSizes.lg,
      textAlign: 'center',
      lineHeight: 22,
      maxWidth: 310,
    },

    // Dots
    dotsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.xl,
    },
    dot: {
      height: 8,
      borderRadius: radii.full,
    },
    dotActive: {
      width: 24,
      backgroundColor: colors.amber,
    },
    dotInactive: {
      width: 8,
      backgroundColor: colors.borderMid,
    },

    // Content layout — the three paged feature slides
    contentNormal: {
      flex: 1,
      flexDirection: 'column',
      width: '100%',
    },

    // ── Welcome screen — content centered, CTA pinned at the bottom ──
    welcomeScreen: {
      flex: 1,
      width: '100%',
      justifyContent: 'center',
      paddingHorizontal: spacing['2xl'],
      paddingBottom: spacing.xl,
      gap: spacing['3xl'],
    },
    welcomeContent: {
      alignItems: 'center',
      gap: spacing.lg,
    },
    welcomeTitle: {
      fontSize: fontSizes['4xl'],
      fontWeight: fontWeights.bold,
      color: colors.textPrimary,
      letterSpacing: -0.6,
      textAlign: 'center',
    },
    welcomeBody: {
      fontSize: fontSizes.lg,
      color: colors.textSecondary,
      lineHeight: 22,
      textAlign: 'center',
      maxWidth: 320,
    },
    welcomeActions: {
      width: '100%',
      alignItems: 'center',
    },

    // CTA — bottom pinned under the slides
    cta: {
      width: '100%',
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing.xl,
      gap: spacing.md,
      alignItems: 'center',
    },

    nextBtn: {
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
    nextText: {
      color: colors.surface,
      fontSize: fontSizes.xl,
      fontWeight: fontWeights.bold,
    },
  })
