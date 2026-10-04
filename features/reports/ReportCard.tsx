/**
 * ReportCard
 *
 * Read-only display card for a single ScoutReport.
 */

import { Text, View } from 'react-native'
import { Card, FieldGrid, Badge } from '@/components/ui'
import { fromE6, formatTimestamp } from '@/lib/format'
import { parseReportStatus } from './types'
import type { ScoutReport } from './types'

interface ReportCardProps {
  report: ScoutReport
}

export function ReportCard({ report }: ReportCardProps) {
  const status = parseReportStatus(report.status)

  return (
    <Card accessibilityLabel={`Scout report #${report.index}, status: ${status}`}>
      <View className="flex-row justify-between items-center">
        <Text className="font-display text-ink font-semibold">Report #{report.index}</Text>
        <Badge status={status} />
      </View>

      <Text className="font-sans text-ink-muted text-sm" numberOfLines={2}>
        {report.aiLabel}
      </Text>

      <FieldGrid
        size="xs"
        fields={[
          ['Lat', fromE6(report.latE6).toFixed(6)],
          ['Lng', fromE6(report.lngE6).toFixed(6)],
        ]}
      />

      <Text className="font-sans text-ink-muted text-xs">{formatTimestamp(report.timestamp)}</Text>
    </Card>
  )
}
