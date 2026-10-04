import { describe, it, expect, afterEach } from 'vitest'
import { render } from '@testing-library/react-native'
import { SeedVaultBadge } from '@/components/seed-vault-badge'

describe('SeedVaultBadge', () => {
  afterEach(() => {
    delete process.env.EXPO_PUBLIC_FORCE_SEEKER
  })

  it('renders nothing off-Seeker', async () => {
    const screen = await render(<SeedVaultBadge />)
    expect(screen.toJSON()).toBeNull()
  })

  it('announces the secured Seed Vault on a Seeker', async () => {
    process.env.EXPO_PUBLIC_FORCE_SEEKER = 'true'
    const screen = await render(<SeedVaultBadge />)

    expect(screen.getByText('Seed Vault secured')).toBeTruthy()
  })
})
