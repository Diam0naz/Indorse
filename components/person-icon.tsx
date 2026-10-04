/**
 * components/person-icon.tsx — Avatar fallback
 *
 * A neutral line-drawn person used when there is no photo, real name or
 * wallet to initial — the honest "no identity yet" mark instead of a
 * placeholder letter from demo data. Decorative: the surrounding Pressable
 * carries the accessibility label.
 */

import Svg, { Circle, Path } from 'react-native-svg'

interface PersonIconProps {
  color: string
  size?: number
  testID?: string
}

export function PersonIcon({ color, size = 24, testID }: PersonIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" testID={testID}>
      <Circle cx="12" cy="8.5" r="3.75" stroke={color} strokeWidth="1.6" />
      <Path d="M4.5 20c.6-3.6 3.8-6 7.5-6s6.9 2.4 7.5 6" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </Svg>
  )
}
