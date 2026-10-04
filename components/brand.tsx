/**
 * components/brand.tsx — Indorse brand mark
 *
 * The hexagonal "node" logo used in the app header and the onboarding slides.
 */

import Svg, { Circle, Path } from 'react-native-svg'
import { useTheme } from '@/components/theme-provider'

export function BrandMark({ size = 32, tint }: { size?: number; tint?: string }) {
  const { colors } = useTheme()
  const color = tint ?? colors.amber
  const s = size / 32
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <Path
        d="M16 3 L4.5 9.5 v13 L16 29 L27.5 22.5 v-13 L16 3z"
        stroke={color}
        strokeWidth={1.3 * s}
        fill="none"
        strokeLinejoin="round"
      />
      <Circle cx={16} cy={16} r={4 * s} fill={color} fillOpacity={0.6} />
      <Circle cx={16} cy={16} r={1.6 * s} fill={color} />
    </Svg>
  )
}
