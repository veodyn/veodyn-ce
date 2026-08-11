'use client'

import { useId } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ChartShape } from '@/components/visualizations/chart/chart-shape'
import type { RedashChartOptions } from '@/services/redash/types'

interface ChartXAxisOptionsProps {
  chartType: ChartShape
  xAxis: RedashChartOptions['xAxis']
  reverseX: boolean
  onXAxisTypeChange: (type: string) => void
  onReverseXChange: (checked: boolean) => void
}

// The x-axis half of what the renderer honors, mirroring ChartYAxisOptions'
// seam. Two controls, each offered only where it takes effect:
//
// The type select forces datetime handling past detection, which is the ONLY
// override resolveChartConfig reads ('category', 'linear' and the rest of
// Redash's list do not defeat detection there, so offering them would be
// controls that change nothing). Auto writes '-', Redash's own spelling, so a
// document round-trips into its editor as "Auto Detect".
//
// Reverse is applied by buildChartData, whose rows only line, bar and area
// plot; scatter and pie draw data.rows directly and never see it.
export function ChartXAxisOptions({
  chartType,
  xAxis,
  reverseX,
  onXAxisTypeChange,
  onReverseXChange,
}: ChartXAxisOptionsProps) {
  const typeId = useId()
  const reverseId = useId()

  if (chartType === 'pie') return null
  const offerReverse = chartType === 'line' || chartType === 'bar' || chartType === 'area'

  return (
    <div className="space-y-1 border rounded p-2">
      <div className="text-xs font-medium text-muted-foreground">X axis</div>
      <div>
        <Label htmlFor={typeId} className="mb-1 block">X Axis Type</Label>
        <Select
          value={xAxis?.type === 'datetime' ? 'datetime' : ''}
          onValueChange={(value) => onXAxisTypeChange(value === 'datetime' ? 'datetime' : '-')}
        >
          <SelectTrigger id={typeId} className="w-full h-8">
            <SelectValue placeholder="Auto (detect)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Auto (detect)</SelectItem>
            <SelectItem value="datetime">Datetime</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {offerReverse && (
        <div className="flex items-center gap-2 text-sm">
          <Checkbox
            id={reverseId}
            checked={reverseX}
            onCheckedChange={(checked) => onReverseXChange(checked)}
          />
          <Label htmlFor={reverseId}>Reverse x axis</Label>
        </div>
      )}
    </div>
  )
}
