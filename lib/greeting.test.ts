/**
 * lib/greeting.test.ts — time-of-day greeting
 */

import { describe, expect, it } from 'vitest'
import { greetingKey } from './greeting'

describe('greetingKey', () => {
  it('greets in the morning before noon', () => {
    expect(greetingKey(5)).toBe('header.greetMorning')
    expect(greetingKey(9)).toBe('header.greetMorning')
    expect(greetingKey(11)).toBe('header.greetMorning')
  })

  it('greets in the afternoon from noon to 18:00', () => {
    expect(greetingKey(12)).toBe('header.greetAfternoon')
    expect(greetingKey(15)).toBe('header.greetAfternoon')
    expect(greetingKey(17)).toBe('header.greetAfternoon')
  })

  it('greets in the evening from 18:00 and overnight', () => {
    expect(greetingKey(18)).toBe('header.greetEvening')
    expect(greetingKey(22)).toBe('header.greetEvening')
    expect(greetingKey(0)).toBe('header.greetEvening')
    expect(greetingKey(4)).toBe('header.greetEvening')
  })

  it('normalises out-of-range hours instead of falling through', () => {
    // 25 → 01:00, 30 → 06:00, -1 → 23:00
    expect(greetingKey(25)).toBe('header.greetEvening')
    expect(greetingKey(30)).toBe('header.greetMorning')
    expect(greetingKey(-1)).toBe('header.greetEvening')
    for (const hour of [-1, 24, 25, 30, 100]) {
      expect(['header.greetMorning', 'header.greetAfternoon', 'header.greetEvening']).toContain(greetingKey(hour))
    }
  })

  it('defaults to the current hour when none is given', () => {
    const expected = greetingKey(new Date().getHours())
    expect(greetingKey()).toBe(expected)
  })
})
