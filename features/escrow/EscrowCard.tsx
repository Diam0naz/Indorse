/**
 * EscrowCard
 *
 * Displays an Escrow account. Shows state badge, amount and lock status.
 * Buyer sees release/cancel options; farmer sees release option.
 *
 * Buyer and farmer addresses are resolved to .skr names when available
 * (useSkrName).  Each falls back to shortenAddress while loading or when no
 * name exists.  The truncated address is shown on a second line whenever a
 * name was resolved, so the user can always verify the raw pubkey.
 */

import { useState } from 'react'
import { Text, View, TouchableOpacity } from 'react-native'
import { Card, Badge } from '@/components/ui'
import { formatUsdc, shortenAddress, formatTimestamp } from '@/lib/format'
import { useSkrName } from '@/lib/skr'
import { parseEscrowState } from './types'
import type { Escrow } from './types'

interface EscrowCardProps {
  escrow: Escrow
  /** Address of the currently connected wallet, to determine which actions to show */
  connectedAddress?: string
  onRelease?: () => void
  onCancel?: () => void
}

export function EscrowCard({ escrow, connectedAddress, onRelease, onCancel }: EscrowCardProps) {
  const state = parseEscrowState(escrow.state)
  // Captured once at mount: a re-render must not shift the lock window.
  const [nowSeconds] = useState(() => Math.floor(Date.now() / 1000))
  const isLocked = nowSeconds >= escrow.lockUntil
  const isFarmer = connectedAddress === escrow.farmer
  const isBuyer = connectedAddress === escrow.buyer

  const buyerSkr = useSkrName(escrow.buyer)
  const farmerSkr = useSkrName(escrow.farmer)
  const buyerLabel = buyerSkr ?? shortenAddress(escrow.buyer, 6)
  const farmerLabel = farmerSkr ?? shortenAddress(escrow.farmer, 6)

  return (
    <Card gap="md" accessibilityLabel={`Escrow ${formatUsdc(escrow.amountUsdc)}, state: ${state}`}>
      <View className="flex-row justify-between items-center">
        <Text className="font-display text-ink font-bold text-base">{formatUsdc(escrow.amountUsdc)}</Text>
        <Badge status={state} />
      </View>

      <View className="gap-1">
        {/* Buyer */}
        <View>
          <Text className="font-sans text-ink-muted text-xs">Buyer: {buyerLabel}</Text>
          {buyerSkr ? (
            <Text className="font-sans text-ink-muted text-xs" numberOfLines={1}>
              {'  '}
              {shortenAddress(escrow.buyer, 6)}
            </Text>
          ) : null}
        </View>

        {/* Farmer */}
        <View>
          <Text className="font-sans text-ink-muted text-xs">Farmer: {farmerLabel}</Text>
          {farmerSkr ? (
            <Text className="font-sans text-ink-muted text-xs" numberOfLines={1}>
              {'  '}
              {shortenAddress(escrow.farmer, 6)}
            </Text>
          ) : null}
        </View>

        <Text className={isLocked ? 'font-sans text-xs text-danger' : 'font-sans text-xs text-ink-muted'}>
          Lock expires: {formatTimestamp(escrow.lockUntil)}
        </Text>
      </View>

      {/* Actions — only visible while funded */}
      {state === 'funded' && (
        <View className="flex-row gap-2 mt-1">
          {isFarmer && onRelease ? (
            <TouchableOpacity
              onPress={onRelease}
              className="flex-1 bg-primary rounded-lg py-2 items-center"
              accessibilityRole="button"
              accessibilityLabel="Release escrow funds"
            >
              <Text className="font-sans text-surface font-semibold text-sm">Release funds</Text>
            </TouchableOpacity>
          ) : null}

          {isBuyer && !isLocked && onCancel ? (
            <TouchableOpacity
              onPress={onCancel}
              className="flex-1 bg-danger rounded-lg py-2 items-center"
              accessibilityRole="button"
              accessibilityLabel="Cancel escrow"
            >
              <Text className="font-sans text-surface font-semibold text-sm">Cancel</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}
    </Card>
  )
}
