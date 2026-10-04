/**
 * constants/theme.test.ts — typography rules in `createStyles`
 *
 * Two text faces: Space Grotesk for headlines / large numbers (≥ 16px or a
 * headline-style key) and Inter for everything smaller. Monospace and the script
 * face are opt-in per style. These tests pin that contract, since it is decided
 * by one numeric constant that is easy to retune by accident.
 */

import { describe, expect, it } from 'vitest'
import type { TextStyle } from 'react-native'
import { createStyles, fonts } from './theme'

/** `createStyles` is generic over its input, so annotate to read `fontFamily`. */
const styles = (input: Record<string, TextStyle>) => createStyles<Record<string, TextStyle>>(input)

describe('createStyles font selection', () => {
  it('splits small text onto the body face and large text onto the display face', () => {
    const s = styles({
      tiny: { fontSize: 9 },
      small: { fontSize: 12 },
      base: { fontSize: 14 },
      big: { fontSize: 16 },
      huge: { fontSize: 32 },
    })

    expect(s.tiny.fontFamily).toBe(fonts.body.regular)
    expect(s.small.fontFamily).toBe(fonts.body.regular)
    expect(s.base.fontFamily).toBe(fonts.body.regular)
    expect(s.big.fontFamily).toBe(fonts.display.regular)
    expect(s.huge.fontFamily).toBe(fonts.display.regular)
  })

  it('puts headline-style keys in the display face whatever their size', () => {
    const s = styles({
      title: { fontSize: 14 },
      headline: { fontSize: 13 },
      displayValue: { fontSize: 12 },
    })

    expect(s.title.fontFamily).toBe(fonts.display.regular)
    expect(s.headline.fontFamily).toBe(fonts.display.regular)
    expect(s.displayValue.fontFamily).toBe(fonts.display.regular)
  })

  it('keeps body-copy keys on the body face, even with a headline-ish name', () => {
    const s = styles({
      subtitle: { fontSize: 13 },
      bannerMessage: { fontSize: 12 },
      rowTitle: { fontSize: 13 },
    })

    expect(s.subtitle.fontFamily).toBe(fonts.body.regular)
    expect(s.bannerMessage.fontFamily).toBe(fonts.body.regular)
    expect(s.rowTitle.fontFamily).toBe(fonts.body.regular)
  })

  it("maps fontWeight onto the matching face for the style's size", () => {
    const s = styles({
      medium: { fontSize: 12, fontWeight: '500' },
      semibold: { fontSize: 12, fontWeight: '600' },
      bold: { fontSize: 12, fontWeight: '700' },
      heavy: { fontSize: 12, fontWeight: '800' },
      titleBold: { fontSize: 22, fontWeight: '700' },
    })

    expect(s.medium.fontFamily).toBe(fonts.body.medium)
    expect(s.semibold.fontFamily).toBe(fonts.body.semibold)
    expect(s.bold.fontFamily).toBe(fonts.body.bold)
    expect(s.heavy.fontFamily).toBe(fonts.body.bold)
    expect(s.titleBold.fontFamily).toBe(fonts.display.bold)
  })

  it('leaves an explicit fontFamily untouched (monospace labels, script greeting)', () => {
    const s = styles({
      tabLabel: { fontSize: 9, fontFamily: 'monospace' },
      pubkey: { fontSize: 11, fontFamily: 'monospace', fontWeight: '700' },
      greeting: { fontSize: 24, fontFamily: fonts.script.regular },
    })

    expect(s.tabLabel.fontFamily).toBe('monospace')
    expect(s.pubkey.fontFamily).toBe('monospace')
    expect(s.greeting.fontFamily).toBe(fonts.script.regular)
  })

  it('never adds a fontFamily to styles with no fontSize', () => {
    const s = styles({
      noSizeText: { color: '#fff' },
    })

    expect(s.noSizeText.fontFamily).toBeUndefined()
  })
})
