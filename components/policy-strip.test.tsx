import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react-native'
import { PolicyStrip } from '@/components/policy-strip'
import type { RosterPolicyItem } from '@/features/insurance/useRosterPolicies'
import type { Policy } from '@/features/insurance/types'

function item(overrides: Partial<RosterPolicyItem>): RosterPolicyItem {
  return {
    farmId: 'f1',
    farmName: 'Farm One',
    farmAddress: 'Addr1',
    state: 'ready',
    policy: null,
    ...overrides,
  }
}

const COVERED: Policy & { address: string } = {
  farm: 'Farm2PDA',
  farmer: 'Wallet2',
  index: 0,
  crop: 'Maize',
  coverageUsdc: 500_000_000,
  premiumUsdc: 25_000_000,
  triggerThresholdMm: 50_000,
  seasonStart: 1_760_000_000,
  seasonEnd: 1_762_000_000,
  verifiedReportsAtCreation: 0,
  state: 'active',
  bump: 254,
  address: 'PolicyPDA2',
}

describe('PolicyStrip', () => {
  it('renders nothing for an empty or single-farm roster', async () => {
    expect((await render(<PolicyStrip items={[]} currentId={null} onSelect={vi.fn()} />)).toJSON()).toBeNull()
    expect((await render(<PolicyStrip items={[item({})]} currentId="f1" onSelect={vi.fn()} />)).toJSON()).toBeNull()
  })

  it('lists one pill per farm in roster order with its policy figure', async () => {
    const screen = await render(
      <PolicyStrip
        items={[
          item({}),
          item({ farmId: 'f2', farmName: 'Farm Two', state: 'ready', policy: COVERED }),
          item({ farmId: 'f3', farmName: 'Farm Three', state: 'unreadable' }),
        ]}
        currentId="f1"
        onSelect={vi.fn()}
      />,
    )

    // Order is the presentation: pills appear exactly as the roster does.
    const labels = screen
      .getAllByRole('button')
      .map((pill: { props: { accessibilityLabel?: string } }) => pill.props.accessibilityLabel)
    expect(labels).toEqual(['Farm One: No policy', 'Farm Two: $500', 'Farm Three: Unreadable'])
  })

  it('selects the tapped farm', async () => {
    const onSelect = vi.fn()
    const screen = await render(
      <PolicyStrip
        items={[item({}), item({ farmId: 'f2', farmName: 'Farm Two' })]}
        currentId="f1"
        onSelect={onSelect}
      />,
    )

    fireEvent.press(screen.getByLabelText('Farm Two: No policy'))
    expect(onSelect).toHaveBeenCalledWith('f2')
  })
})
