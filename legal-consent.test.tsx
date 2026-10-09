/**
 * legal-consent.test.tsx — the Terms & Privacy screen and the consent gate
 *
 * Onboarding is the only screen first-time users ever see before the app
 * (app/index.tsx routes unregistered users here and returning users straight
 * into the tabs), so it is the one place consent can be collected. This locks
 * three things:
 *
 *   1. Enter App does not navigate until the box is ticked,
 *   2. both documents are reachable from that box,
 *   3. the Terms & Privacy screen renders both documents, stamped with their
 *      version and actually quoting the contact mailbox — so a doc that stops
 *      interpolating OPERATOR_NAME or CONTACT_EMAIL fails here rather than
 *      shipping a broken "write to us" line.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react-native'
import LegalScreen from '@/app/legal'
import OnboardingScreen from '@/app/onboarding'
import { CONTACT_EMAIL, LEGAL_UPDATED, LEGAL_VERSION, OPERATOR_NAME, PRIVACY, TERMS } from '@/constants/legal'

// vi.mock is hoisted above the imports, so the spies it closes over have to be
// created in the same hoisted pass.
const { push, replace } = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))

vi.mock('expo-router', () => ({
  router: { push, replace, back: vi.fn() },
  useRouter: () => ({ push, replace, back: vi.fn() }),
  usePathname: () => '/',
  useLocalSearchParams: () => ({}),
}))

vi.mock('react-native-safe-area-context', async () => {
  const { View } = await import('react-native')
  return {
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    SafeAreaView: View,
  }
})

const LOAD = { timeout: 5000 }

/** Exactly how onboarding assembles the checkbox's accessible name. */
const CONSENT = 'I have read and agree to the Terms of Use and Privacy Policy.'

/** Splash auto-advances after 1.5s; Skip jumps straight to the welcome screen. */
async function renderWelcome() {
  await render(<OnboardingScreen />)
  await screen.findByText('Skip', {}, LOAD)
  await fireEvent.press(screen.getByText('Skip'))
  await screen.findByText('Welcome back', {}, LOAD)
}

describe('consent gate on the welcome screen', () => {
  beforeEach(() => {
    push.mockClear()
    replace.mockClear()
  })

  it('offers the Terms and the Privacy Policy as links', async () => {
    await renderWelcome()

    expect(screen.getByLabelText(CONSENT)).toBeTruthy()
    expect(screen.getByText('Terms of Use')).toBeTruthy()
    expect(screen.getByText('Privacy Policy')).toBeTruthy()
  })

  it('holds Enter App until the box is ticked', async () => {
    await renderWelcome()

    await fireEvent.press(screen.getByText('Enter App'))
    expect(replace).not.toHaveBeenCalled()
    expect(screen.getByText('Tick the box above to continue.')).toBeTruthy()
  })

  it('enters the app once accepted, and clears the nudge', async () => {
    await renderWelcome()

    await fireEvent.press(screen.getByLabelText(CONSENT))
    await fireEvent.press(screen.getByText('Enter App'))

    expect(replace).toHaveBeenCalledWith('/(tabs)')
    expect(screen.queryByText('Tick the box above to continue.')).toBeNull()
  })

  it('opens each document from its own link', async () => {
    await renderWelcome()

    await fireEvent.press(screen.getByText('Terms of Use'))
    expect(push).toHaveBeenCalledWith('/legal?tab=terms')

    await fireEvent.press(screen.getByText('Privacy Policy'))
    expect(push).toHaveBeenCalledWith('/legal?tab=privacy')
  })
})

describe('the Terms & Privacy screen', () => {
  it('renders the Terms of Use by default, with the version stamp', async () => {
    await render(<LegalScreen />)

    expect(screen.getByText(`Version ${LEGAL_VERSION} · Updated ${LEGAL_UPDATED}`)).toBeTruthy()
    expect(screen.getByText(TERMS.intro)).toBeTruthy()
    expect(screen.getByText(TERMS.sections[0].title)).toBeTruthy()
    expect(screen.getByText(TERMS.sections[TERMS.sections.length - 1].title)).toBeTruthy()
  })

  it('switches to the Privacy Policy and renders that instead', async () => {
    await render(<LegalScreen />)

    await fireEvent.press(screen.getByLabelText('Privacy Policy'))

    expect(screen.getByText(PRIVACY.intro)).toBeTruthy()
    expect(screen.getByText(PRIVACY.sections[0].title)).toBeTruthy()
    expect(screen.queryByText(TERMS.intro)).toBeNull()
  })

  it('names the operator and quotes the contact mailbox in both documents', () => {
    // The mailbox is interpolated, never typed out: change CONTACT_EMAIL in
    // constants/legal.ts and both places below follow. Shipping a document
    // that tells the user to write to an address it never prints is the bug
    // this exists to catch.
    expect(TERMS.intro).toContain(OPERATOR_NAME)
    expect(PRIVACY.intro).toContain(OPERATOR_NAME)
    expect(TERMS.sections[TERMS.sections.length - 1].body.join(' ')).toContain(CONTACT_EMAIL)
    expect(PRIVACY.sections[PRIVACY.sections.length - 1].body.join(' ')).toContain(CONTACT_EMAIL)
  })
})

afterEach(() => {
  vi.clearAllMocks()
})
