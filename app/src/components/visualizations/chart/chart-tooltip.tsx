'use client'

import type { TooltipContentProps } from 'recharts'
import { formatCompactNumber, formatDateLabel } from '@/lib/chart-format'
import type { DisplayPatterns } from '@/lib/date-pattern'

interface ChartTooltipProps extends Partial<TooltipContentProps<number, string>> {
  xIsDatetime?: boolean
  xHasTime?: boolean
  // The same configured formats the axis under this tooltip is labelled with,
  // passed from the renderer that owns both. A tooltip that read the setting
  // separately would be a second place to get it wrong, and the two disagreeing
  // about the same instant is worse than either form on its own.
  patterns: DisplayPatterns
  valueFormatter?: (value: number) => string
}

export function ChartTooltip({ active, payload, label, xIsDatetime, xHasTime, patterns, valueFormatter }: ChartTooltipProps) {
  if (!active || !payload?.length) return null
  const formatValue = valueFormatter ?? formatCompactNumber

  return (
    <div className="rounded-md border bg-card px-3 py-2 text-sm shadow-md">
      <div className="mb-1 font-medium text-card-foreground">
        {xIsDatetime ? formatDateLabel(label, xHasTime ?? false, patterns) : String(label)}
      </div>
      <div className="space-y-0.5">
        {payload.map((entry) => (
          <div key={entry.dataKey ? String(entry.dataKey) : entry.name} className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
            <span className="text-muted-foreground">{entry.name}:</span>
            <span className="font-medium tabular-nums">
              {typeof entry.value === 'number' ? formatValue(entry.value) : String(entry.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
