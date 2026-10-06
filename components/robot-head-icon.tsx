/**
 * components/robot-head-icon.tsx — the guide's face
 *
 * A line-drawn robot head — antenna, side ears, eyes, smile — used wherever
 * the Ask indorse assistant shows itself: the floating chip (white on amber)
 * and the "Thinking…" spinner appended to the thread, which turns it in
 * uneven beats while a reply is on its way. Decorative: the surrounding
 * Pressable or row carries the accessibility label.
 */

import Svg, { Circle, Path, Rect } from 'react-native-svg'

interface RobotHeadIconProps {
  color: string
  size?: number
  testID?: string
}

export function RobotHeadIcon({ color, size = 22, testID }: RobotHeadIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" testID={testID}>
      <Circle cx="12" cy="2.8" r="1.5" fill={color} />
      <Path d="M12 4.6v1.9" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      <Rect x="4.5" y="6.4" width="15" height="12.8" rx="3.2" stroke={color} strokeWidth="1.6" />
      <Rect x="2.2" y="10.6" width="2.3" height="4.2" rx="1.15" stroke={color} strokeWidth="1.5" />
      <Rect x="19.5" y="10.6" width="2.3" height="4.2" rx="1.15" stroke={color} strokeWidth="1.5" />
      <Circle cx="9.4" cy="11.9" r="1.35" fill={color} />
      <Circle cx="14.6" cy="11.9" r="1.35" fill={color} />
      <Path d="M9.7 15.5c1.4 1.1 3.2 1.1 4.6 0" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </Svg>
  )
}
