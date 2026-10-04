import { render } from '@testing-library/react-native'
import { Text } from 'react-native'
import { describe, expect, it } from 'vitest'
import { AppProviders } from '@/components/app-providers'

describe('AppProviders', () => {
  it('renders its children', async () => {
    const screen = await render(
      <AppProviders>
        <Text>ready</Text>
      </AppProviders>,
    )

    expect(screen.getByText('ready')).toBeTruthy()
  })
})
