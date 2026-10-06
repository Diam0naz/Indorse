/**
 * HarvestCard
 *
 * Displays a single HarvestBatch with its provenance summary.
 * Buyers see the farm's scouting history alongside the batch details —
 * the key trust signal that justifies paying into escrow.
 */

import { View, Text } from 'react-native'
import { Card, FieldGrid } from '@/components/ui'
import { fromE6, formatTimestamp } from '@/lib/format'
import { useTheme } from '@/components/theme-provider'
import { batchProvenanceSummary, GRADE_LABELS, gradeNeedsReview } from './types'
import type { HarvestBatch } from './types'
import { FontAwesome5 } from '@expo/vector-icons'

interface HarvestCardProps {
  batch: HarvestBatch
}

export function HarvestCard({ batch }: HarvestCardProps) {
  const { colors } = useTheme()
  const provenance = batchProvenanceSummary(batch)
  const graded = batch.grade > 0 && batch.grade <= 4
  const letter = graded ? GRADE_LABELS[batch.grade] : '—'

  return (
    <Card gap="md" accessibilityLabel={`Harvest batch #${batch.index}, ${batch.crop}`}>
      {/* Header */}
      <Text className="font-display text-primary font-bold text-base">
        Batch #{batch.index} — {batch.crop}
      </Text>
      <Text className="font-sans text-ink-muted text-xs -mt-2">{formatTimestamp(batch.timestamp)}</Text>

      {/* Quantity */}
      <View className="flex-row items-center gap-2">
        <FontAwesome5 name="wheat-awn" size={24} color={colors.amber} />
        <Text className="font-display text-ink text-lg font-semibold">{batch.quantityKg.toLocaleString()} kg</Text>
      </View>

      {/* AI grade — the buyer's headline signal before locking funds.
          Ungraded batches (grade 0) make no claim at all. */}
      {graded ? (
        <View>
          <Text className="font-sans bg-surface rounded-lg px-3 py-2 text-ink-muted text-xs mb-0.5">AI grade</Text>
          <Text className="font-sans text-accent text-sm -mt-3">
            Grade {letter} · {batch.gradeConfidence}% confidence
            {gradeNeedsReview(batch.gradeFlags) ? ' · flagged for a verifier' : ''}
          </Text>
          {batch.gradeNotes ? (
            <Text className="font-sans text-ink-muted text-xs italic">{batch.gradeNotes}</Text>
          ) : null}
        </View>
      ) : null}

      {/* Provenance — the key trust signal */}
      <Text className="font-sans bg-surface rounded-lg px-3 py-2 text-ink-muted text-xs mb-0.5">
        Scouting provenance
      </Text>
      <Text className="font-sans text-accent text-sm -mt-3">{provenance}</Text>

      {/* GPS */}
      <FieldGrid
        size="xs"
        fields={[
          ['Lat', fromE6(batch.latE6).toFixed(4)],
          ['Lng', fromE6(batch.lngE6).toFixed(4)],
        ]}
      />

      {/* Notes */}
      {batch.notes ? (
        <Text className="font-sans text-ink-muted text-sm" numberOfLines={3}>
          {batch.notes}
        </Text>
      ) : null}
    </Card>
  )
}
