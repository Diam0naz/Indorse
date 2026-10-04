/**
 * FarmCard
 *
 * Read-only display card for a registered farm.
 * Accepts a Farm object and renders its name, coordinates and stats.
 *
 * The owner field resolves to a .skr domain when available (via useSkrName)
 * and falls back to shortenAddress while loading or when no name is found.
 * The truncated address is always shown below the resolved name so the user
 * can verify the underlying pubkey — a .skr name is not self-asserted.
 */

import { Text, View } from 'react-native'
import { Card, FieldGrid } from '@/components/ui'
import { fromE6, shortenAddress } from '@/lib/format'
import { useSkrName } from '@/lib/skr'
import type { Farm } from './types'

interface FarmCardProps {
  farm: Farm
}

export function FarmCard({ farm }: FarmCardProps) {
  const skrName = useSkrName(farm.owner)
  const ownerLabel = skrName ?? shortenAddress(farm.owner, 8)

  return (
    <Card accessibilityLabel={`Farm: ${farm.name}`}>
      <Text className="font-display text-ink text-lg font-bold">{farm.name}</Text>

      <FieldGrid
        fields={[
          ['Latitude', fromE6(farm.latE6).toFixed(6)],
          ['Longitude', fromE6(farm.lngE6).toFixed(6)],
        ]}
      />

      <FieldGrid fields={[['Reports', String(farm.reportCount)]]} />

      {/* Owner row — rendered outside FieldGrid so we can stack name + address. */}
      <View>
        <Text className="font-sans text-ink-muted text-xs">Owner</Text>
        <Text className="font-sans text-ink text-sm" numberOfLines={1}>
          {ownerLabel}
        </Text>
        {skrName ? (
          <Text className="font-sans text-ink-muted text-xs" numberOfLines={1}>
            {shortenAddress(farm.owner, 8)}
          </Text>
        ) : null}
      </View>
    </Card>
  )
}
