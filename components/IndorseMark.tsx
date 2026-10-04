/**
 * components/IndorseMark.tsx — Indorse brand mark (custom SVG)
 *
 * Solflare-inspired facet treatment: a gold→ember gradient over the hexagonal
 * "I" silhouette, layered with shadow/highlight facets, a hairline edge and
 * wing diamonds. `variant` flips the tile between a dark backing and a light
 * gradient; `showTile` drops the tile for bare placements.
 */

import Svg, { Defs, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg'

export function IndorseMark({
  size = 200,
  showTile = true,
  variant = 'dark',
}: {
  size?: number
  showTile?: boolean
  variant?: 'dark' | 'light'
}) {
  const uid = `im-${size}-${variant}`

  const outer = [
    'M 100,14',
    'L 158,36',
    'L 172,56',
    'L 124,70',
    'L 124,134',
    'L 172,148',
    'L 158,168',
    'L 100,186',
    'L 42,168',
    'L 28,148',
    'L 76,134',
    'L 76,70',
    'L 28,56',
    'L 42,36',
    'Z',
  ].join(' ')

  const crownNotch = 'M 100,14 L 116,42 L 100,54 L 84,42 Z'
  const crossbar = 'M 76,102 L 89,89 L 111,89 L 124,102 L 111,115 L 89,115 Z'
  const footNotch = 'M 100,186 L 116,158 L 100,146 L 84,158 Z'

  const wings = (
    [
      [28, 56],
      [172, 56],
      [28, 148],
      [172, 148],
    ] as [number, number][]
  )
    .map(([cx, cy]) => `M ${cx},${cy - 10} L ${cx + 10},${cy} L ${cx},${cy + 10} L ${cx - 10},${cy} Z`)
    .join(' ')

  const compound = `${outer} ${crownNotch} ${crossbar} ${footNotch}`

  const isDark = variant === 'dark'

  return (
    <Svg viewBox="0 0 200 200" width={size} height={size} fill="none" style={{ flexShrink: 0 }}>
      <Defs>
        <LinearGradient id={`${uid}-ag`} x1="30" y1="10" x2="170" y2="190" gradientUnits="userSpaceOnUse">
          <Stop offset="0%" stopColor="#fff2b8" />
          <Stop offset="20%" stopColor="#ffcf4d" />
          <Stop offset="55%" stopColor="#f2872b" />
          <Stop offset="100%" stopColor="#7a1f0d" />
        </LinearGradient>
        <LinearGradient id={`${uid}-hl`} x1="20" y1="0" x2="90" y2="100" gradientUnits="userSpaceOnUse">
          <Stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
          <Stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </LinearGradient>
        <LinearGradient id={`${uid}-sh`} x1="110" y1="100" x2="190" y2="200" gradientUnits="userSpaceOnUse">
          <Stop offset="0%" stopColor="#000000" stopOpacity="0" />
          <Stop offset="100%" stopColor="#000000" stopOpacity="0.35" />
        </LinearGradient>
        <LinearGradient id={`${uid}-lt`} x1="0" y1="0" x2="200" y2="200" gradientUnits="userSpaceOnUse">
          <Stop offset="0%" stopColor="#ffcf4d" />
          <Stop offset="100%" stopColor="#b0400f" />
        </LinearGradient>
        <RadialGradient id={`${uid}-gw`} cx="30%" cy="22%" r="55%">
          <Stop offset="0%" stopColor="#f2872b" stopOpacity={isDark ? '0.28' : '0.32'} />
          <Stop offset="100%" stopColor="#f2872b" stopOpacity="0" />
        </RadialGradient>
      </Defs>

      {showTile && (
        <>
          <Rect width="200" height="200" rx="48" fill={isDark ? '#0a0904' : `url(#${uid}-lt)`} />
          <Rect width="200" height="200" rx="48" fill={`url(#${uid}-gw)`} />
          <Rect
            x="1"
            y="1"
            width="198"
            height="198"
            rx="47"
            stroke={isDark ? '#2a1c0a' : 'rgba(255,255,255,0.18)'}
            strokeWidth="1.5"
            fill="none"
          />
        </>
      )}

      <Path fillRule="evenodd" fill={isDark ? `url(#${uid}-ag)` : '#0a0904'} d={compound} />

      <Path fillRule="evenodd" fill={`url(#${uid}-sh)`} d={compound} />

      <Path fillRule="evenodd" fill={`url(#${uid}-hl)`} d={compound} />

      <Path
        fillRule="evenodd"
        fill="none"
        stroke={isDark ? 'rgba(255,207,77,0.28)' : 'rgba(255,255,255,0.15)'}
        strokeWidth="1.25"
        d={compound}
      />

      <Path fill={isDark ? `url(#${uid}-ag)` : '#0a0904'} d={wings} />
    </Svg>
  )
}

/**
 * Small variant — header/onboarding brand tile at 16–32 px.
 * Fixed gold gradient on a dark rounded tile, no theme dependency.
 */
export function IndorseMarkSmall({ size = 32 }: { size?: number }) {
  const outer =
    'M 100,14 L 158,36 L 172,56 L 124,70 L 124,134 L 172,148 L 158,168 L 100,186 L 42,168 L 28,148 L 76,134 L 76,70 L 28,56 L 42,36 Z'
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size} fill="none" style={{ flexShrink: 0 }}>
      <Defs>
        <LinearGradient id="sm-ag" x1="30" y1="10" x2="170" y2="190" gradientUnits="userSpaceOnUse">
          <Stop offset="0%" stopColor="#fff2b8" />
          <Stop offset="30%" stopColor="#ffcf4d" />
          <Stop offset="100%" stopColor="#7a1f0d" />
        </LinearGradient>
      </Defs>
      <Rect width="200" height="200" rx="48" fill="#0a0904" />
      <Rect x="1" y="1" width="198" height="198" rx="47" stroke="#2a1c0a" strokeWidth="1.5" fill="none" />
      <Path fill="url(#sm-ag)" d={outer} />
    </Svg>
  )
}
