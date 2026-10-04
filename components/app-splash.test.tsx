/**
 * Launch-splash tests (AppSplash)
 *
 * The splash is the app's first screen: the Indorse mark on a rounded card,
 * held for two seconds before the root layout swaps it for the auth gate.
 * What it must never do is hand over early (the passcode form would show up
 * under the splash) or late (a splash that outstays its welcome).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react-native'
import { AppSplash } from '@/components/app-splash'

const SPLASH_MS = 2000

describe('AppSplash', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the mark on a rounded, shadow-casting card with the wordmark', async () => {
    const utils = await render(<AppSplash onDone={() => undefined} />)

    expect(utils.getByTestId('app-splash')).toBeTruthy()
    expect(utils.getByText('indorse')).toBeTruthy()

    const style = utils.getByTestId('app-splash-card').props.style
    expect(style.borderRadius).toBeGreaterThan(0)
    expect(style.elevation).toBeGreaterThan(0)
    expect(style.shadowOpacity).toBeGreaterThan(0)
  })

  it('holds for exactly two seconds before handing over', async () => {
    vi.useFakeTimers()
    const onDone = vi.fn()
    await render(<AppSplash onDone={onDone} />)

    await act(async () => {
      vi.advanceTimersByTime(SPLASH_MS - 1)
    })
    expect(onDone).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('clears the handover timer if it unmounts first', async () => {
    vi.useFakeTimers()
    const onDone = vi.fn()
    const utils = await render(<AppSplash onDone={onDone} />)

    await utils.unmount()
    await act(async () => {
      vi.advanceTimersByTime(SPLASH_MS * 2)
    })
    expect(onDone).not.toHaveBeenCalled()
  })
})
