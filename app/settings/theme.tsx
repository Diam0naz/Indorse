/**
 * app/settings/theme.tsx — Theme switch
 *
 * System / Dark Field / Light Paper, plus Seeker Midnight — shown only on
 * Seeker devices (or while it is the active mode, so it can always be left
 * again). The mode persists through `ThemeProvider`; the palettes themselves
 * are the same tokens the rest of the app builds its styles from, and each
 * row shows a live swatch of what that choice looks like.
 */

import { View, useColorScheme } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { SettingsGroup, SettingsNote, SettingsScreen, SettingRow } from '@/components/settings-ui'
import { useTheme, type ThemeMode } from '@/components/theme-provider'
import { createStyles, colors as darkColors, lightColors, seekerColors, radii, type Colors } from '@/constants/theme'
import { isSeekerDevice } from '@/lib/seeker'
import { useT, type MessageKey } from '@/lib/i18n'

const MODES: { mode: ThemeMode; title: MessageKey; body: MessageKey }[] = [
  { mode: 'system', title: 'theme.system', body: 'theme.systemBody' },
  { mode: 'dark', title: 'theme.dark', body: 'theme.darkBody' },
  { mode: 'light', title: 'theme.light', body: 'theme.lightBody' },
  { mode: 'seeker', title: 'theme.seeker', body: 'theme.seekerBody' },
]

function paletteFor(mode: ThemeMode, systemIsLight: boolean): Colors {
  if (mode === 'system') return systemIsLight ? lightColors : darkColors
  if (mode === 'light') return lightColors
  if (mode === 'seeker') return seekerColors
  return darkColors
}

/** Tiny card mock-up rendered in the palette that row would select. */
function PreviewSwatch({ palette }: { palette: Colors }) {
  const styles = createStyles({
    swatch: {
      width: 76,
      height: 46,
      borderRadius: radii.sm,
      borderWidth: 1,
      borderColor: palette.borderHi,
      backgroundColor: palette.surface,
      paddingHorizontal: 8,
      paddingVertical: 7,
      gap: 5,
      justifyContent: 'center',
    },
    lineWide: { height: 5, borderRadius: 3, backgroundColor: palette.textSecondary, width: '75%' },
    lineNarrow: { height: 5, borderRadius: 3, backgroundColor: palette.textMuted, width: '50%' },
    pills: { flexDirection: 'row', gap: 4 },
    amberPill: { width: 16, height: 5, borderRadius: 3, backgroundColor: palette.amber },
    sagePill: { width: 16, height: 5, borderRadius: 3, backgroundColor: palette.sage },
  })

  return (
    <View style={styles.swatch}>
      <View style={styles.lineWide} />
      <View style={styles.lineNarrow} />
      <View style={styles.pills}>
        <View style={styles.amberPill} />
        <View style={styles.sagePill} />
      </View>
    </View>
  )
}

export default function ThemeSettingsScreen() {
  const { mode, setMode, colors } = useTheme()
  const t = useT()
  const systemScheme = useColorScheme()

  // Seeker Midnight is a device exclusive; keep it listed while active so a
  // mode restored on the wrong device can always be switched away again.
  const options = MODES.filter((option) => option.mode !== 'seeker' || isSeekerDevice() || mode === 'seeker')

  return (
    <SettingsScreen title={t('theme.title')} subtitle={t('theme.subtitle')}>
      <SettingsGroup label={t('theme.subtitle')}>
        {options.map((option, index) => {
          const selected = option.mode === mode
          return (
            <SettingRow
              key={option.mode}
              title={t(option.title)}
              description={t(option.body)}
              onPress={() => setMode(option.mode)}
              last={index === options.length - 1}
            >
              <PreviewSwatch palette={paletteFor(option.mode, systemScheme === 'light')} />
              {selected && (
                <Svg width={16} height={16} viewBox="0 0 16 16" fill="none">
                  <Path
                    d="M3 8.5 6.5 12 13 4.5"
                    stroke={colors.amber}
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
              )}
            </SettingRow>
          )
        })}
      </SettingsGroup>

      <SettingsNote>{t('theme.note')}</SettingsNote>
    </SettingsScreen>
  )
}
