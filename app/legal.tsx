/**
 * app/legal.tsx — Terms of Use and Privacy Policy, readable in the app.
 *
 * Open it with: router.push('/legal?tab=terms')  or  router.push('/legal?tab=privacy')
 *
 * Reached from the Profile tab's Settings list (Terms & Privacy row) and from
 * the onboarding consent checkbox. The wording itself lives in
 * constants/legal.ts — this screen only renders it.
 *
 * Long-form legal text reads better as headings + paragraphs than as the
 * settings row list, but the shell, header, palette and type are the app's
 * own (SettingsScreen + the shared theme), so it never looks like a
 * bolted-on web view.
 */

import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { Card } from '@/components/screen-kit'
import { SettingsScreen } from '@/components/settings-ui'
import { useTheme } from '@/components/theme-provider'
import { LEGAL_UPDATED, LEGAL_VERSION, PRIVACY, TERMS, type LegalDoc } from '@/constants/legal'
import { createStyles, fontSizes, fontWeights, radii, spacing, type Colors } from '@/constants/theme'
import { useT, type MessageKey } from '@/lib/i18n'

type Tab = 'terms' | 'privacy'

const DOCS: Record<Tab, LegalDoc> = { terms: TERMS, privacy: PRIVACY }
const TAB_LABEL_KEYS: Record<Tab, MessageKey> = { terms: 'legal.termsTab', privacy: 'legal.privacyTab' }

export default function LegalScreen() {
  const params = useLocalSearchParams<{ tab?: string }>()
  const [tab, setTab] = useState<Tab>(params.tab === 'privacy' ? 'privacy' : 'terms')
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const t = useT()

  const doc = DOCS[tab]

  return (
    <SettingsScreen
      title={t('legal.title')}
      subtitle={`${t('legal.version')} ${LEGAL_VERSION} · ${t('legal.updated')} ${LEGAL_UPDATED}`}
    >
      {/* ── Terms / Privacy switch ─────────────────────────────────── */}
      <View style={styles.tabs} accessibilityRole="tablist">
        {(Object.keys(DOCS) as Tab[]).map((key) => {
          const active = key === tab
          return (
            <Pressable
              key={key}
              accessibilityRole="tab"
              accessibilityLabel={t(TAB_LABEL_KEYS[key])}
              accessibilityState={{ selected: active }}
              onPress={() => setTab(key)}
              style={[styles.tab, active && styles.tabActive]}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{t(TAB_LABEL_KEYS[key])}</Text>
            </Pressable>
          )
        })}
      </View>

      {/* ── The document ───────────────────────────────────────────── */}
      <Text accessibilityRole="header" style={styles.docTitle}>
        {doc.title}
      </Text>
      <Text style={styles.intro}>{doc.intro}</Text>

      {doc.sections.map((section) => (
        <View key={section.id} style={styles.section}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            {section.title}
          </Text>
          <Card>
            <View style={styles.paras}>
              {section.body.map((paragraph, i) => (
                <Text key={i} style={styles.paragraph}>
                  {paragraph}
                </Text>
              ))}
            </View>
          </Card>
        </View>
      ))}
    </SettingsScreen>
  )
}

/* ── Styles ─────────────────────────────────────────────────────────── */

const makeStyles = (colors: Colors) =>
  createStyles({
    tabs: {
      flexDirection: 'row',
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.lg,
      padding: spacing.xs,
      gap: spacing.xs,
      marginBottom: spacing.xl,
    },
    tab: {
      flex: 1,
      paddingVertical: spacing.sm + 2,
      borderRadius: radii.md,
      alignItems: 'center',
    },
    tabActive: {
      backgroundColor: colors.amber,
    },
    tabText: {
      fontSize: fontSizes.sm,
      fontWeight: fontWeights.semibold,
      color: colors.textMuted,
    },
    tabTextActive: {
      color: colors.surface,
    },

    docTitle: {
      fontSize: fontSizes['2xl'],
      fontWeight: fontWeights.bold,
      color: colors.textPrimary,
      letterSpacing: -0.4,
    },
    intro: {
      fontSize: fontSizes.md,
      lineHeight: 22,
      color: colors.textSecondary,
      marginTop: spacing.md,
    },

    section: {
      marginTop: spacing.xl,
      gap: spacing.sm,
    },
    sectionTitle: {
      fontSize: fontSizes.lg,
      fontWeight: fontWeights.semibold,
      color: colors.textPrimary,
    },
    paras: {
      gap: spacing.md,
    },
    paragraph: {
      fontSize: fontSizes.md,
      lineHeight: 22,
      color: colors.textSecondary,
    },
  })
