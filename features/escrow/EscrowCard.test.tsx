/**
 * EscrowCard render tests.
 *
 * Verifies the card renders the right badge and role-gated actions for each
 * state — the visual regression the headless smoke test caught (released
 * escrows previously rendered the "Funded" badge).
 *
 * useSkrName is mocked to return null so these tests exercise the
 * shortenAddress fallback path and do not need a QueryClient provider.
 */

import { render } from '@testing-library/react-native'
import { describe, it, expect, vi } from 'vitest'
import { EscrowCard } from '@/features/escrow/EscrowCard'
import type { Escrow } from '@/features/escrow/types'

// Stub useSkrName — always returns null (no .skr name), so the card falls back
// to shortenAddress.  Avoids needing a QueryClient in every render call.
vi.mock('@/lib/skr', () => ({ useSkrName: () => null }))

const BUYER = 'GVenujqgMJZCvYPKqMmPiAXQp7o3mwQbXw1nSBu3U5Ht'
const FARMER = 'FarmrerAddr111111111111111111111111111111111'

function makeEscrow(overrides: Partial<Escrow> = {}): Escrow {
  return {
    batch: 'Batch #5',
    buyer: BUYER,
    farmer: FARMER,
    amountUsdc: 500_000_000,
    lockUntil: Math.floor(Date.now() / 1000) + 86_400,
    state: 'funded',
    bump: 255,
    ...overrides,
  }
}

describe('EscrowCard', () => {
  it('renders the amount and Funded badge for a funded escrow', async () => {
    const screen = await render(<EscrowCard escrow={makeEscrow()} connectedAddress={BUYER} />)
    expect(screen.getByText('$500.00')).toBeTruthy()
    expect(screen.getByText('Funded')).toBeTruthy()
  })

  it('renders the Released badge for a released escrow (regression)', async () => {
    const screen = await render(<EscrowCard escrow={makeEscrow({ state: 'released' })} connectedAddress={FARMER} />)
    expect(screen.getByText('Released')).toBeTruthy()
    expect(screen.queryByText('Funded')).toBeNull()
  })

  it('renders the Cancelled badge for a cancelled escrow', async () => {
    const screen = await render(<EscrowCard escrow={makeEscrow({ state: 'cancelled' })} connectedAddress={BUYER} />)
    expect(screen.getByText('Cancelled')).toBeTruthy()
  })

  it('shows the Cancel button to the buyer while funded and unlocked', async () => {
    const onCancel = vi.fn()
    const screen = await render(<EscrowCard escrow={makeEscrow()} connectedAddress={BUYER} onCancel={onCancel} />)
    expect(screen.getByLabelText('Cancel escrow')).toBeTruthy()
    expect(screen.queryByLabelText('Release escrow funds')).toBeNull()
  })

  it('shows the Release button to the farmer while funded', async () => {
    const onRelease = vi.fn()
    const screen = await render(<EscrowCard escrow={makeEscrow()} connectedAddress={FARMER} onRelease={onRelease} />)
    expect(screen.getByLabelText('Release escrow funds')).toBeTruthy()
    expect(screen.queryByLabelText('Cancel escrow')).toBeNull()
  })

  it('hides all actions once released', async () => {
    const screen = await render(
      <EscrowCard
        escrow={makeEscrow({ state: 'released' })}
        connectedAddress={BUYER}
        onRelease={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.queryByLabelText('Cancel escrow')).toBeNull()
    expect(screen.queryByLabelText('Release escrow funds')).toBeNull()
  })

  it('shortens buyer and farmer addresses', async () => {
    const screen = await render(<EscrowCard escrow={makeEscrow()} connectedAddress={BUYER} />)
    expect(screen.getByText(`Buyer: GVenuj…U5Ht`)).toBeTruthy()
    expect(screen.getByText(`Farmer: Farmre…1111`)).toBeTruthy()
  })
})
