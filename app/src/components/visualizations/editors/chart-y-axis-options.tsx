'use client'

import { useId } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { RedashAxisOptions } from '@/services/redash/types'

interface ChartYAxisOptionsProps {
  chartType: string
  yAxis: RedashAxisOptions[]
  indexed: boolean
  stacking: string
  onUpdateAxis: (patch: Partial<RedashAxisOptions>) => void
  onIndexedChange: (checked: boolean) => void
}

// Pulled out of ChartEditor as its own component: not to hit the file-size
// number, but because it is a real seam. Every control here reads and writes
// only `yAxis[0]`, `indexed` and `stacking`, and the two disabled-with-a-reason
// messages both explain why THIS group of controls can't take effect right
// now. Nothing else in ChartEditor reaches into this state.
export function ChartYAxisOptions({
  chartType,
  yAxis,
  indexed,
  stacking,
  onUpdateAxis,
  onIndexedChange,
}: ChartYAxisOptionsProps) {
  // Tied to the controls they name, same as every other label in this editor
  // family; kept here rather than threaded down as props since nothing
  // outside this component needs to know these ids.
  const logScaleId = useId()
  const indexToId = useId()

  return (
    <div className="space-y-1 border rounded p-2">
      <div className="text-xs font-medium text-muted-foreground">Y axis</div>
      <div className="flex items-center gap-2 text-sm">
        <Checkbox
          id={logScaleId}
          checked={yAxis[0]?.type === 'logarithmic'}
          onCheckedChange={(checked) => onUpdateAxis({ type: checked ? 'logarithmic' : 'linear' })}
          disabled={indexed}
        />
        <Label htmlFor={logScaleId}>Log scale</Label>
      </div>
      <div className="flex gap-1">
        <Input
          type="number"
          placeholder="min"
          value={yAxis[0]?.rangeMin ?? ''}
          onChange={(e) => onUpdateAxis({ rangeMin: e.target.value === '' ? undefined : Number(e.target.value) })}
          className="flex-1 min-w-0 h-7 text-xs"
          disabled={indexed}
        />
        <Input
          type="number"
          placeholder="max"
          value={yAxis[0]?.rangeMax ?? ''}
          onChange={(e) => onUpdateAxis({ rangeMax: e.target.value === '' ? undefined : Number(e.target.value) })}
          className="flex-1 min-w-0 h-7 text-xs"
          disabled={indexed}
        />
      </div>
      {indexed && (
        // yAxisPropsFor (axis-config.ts) always renders an indexed chart
        // linear with an automatic range: a log domain can't cross zero,
        // which indexing can produce, and a saved raw-magnitude bound no
        // longer means anything once every series sits near 100.
        <p className="text-xs text-muted-foreground">
          Log scale and range are not available on an indexed chart: it always renders on a linear scale with an
          automatic range.
        </p>
      )}
      {chartType !== 'scatter' && (
        <div className="flex items-center gap-2 text-sm">
          <Checkbox
            id={indexToId}
            checked={indexed}
            onCheckedChange={onIndexedChange}
            disabled={stacking !== 'disabled'}
          />
          <Label htmlFor={indexToId}>Index to 100</Label>
        </div>
      )}
      {chartType !== 'scatter' && stacking !== 'disabled' && (
        // effectiveIndexed always returns false while stacking is on
        // (resolve-config.ts): stacking sums series, indexed series are
        // ratios, and ratios can't be summed. Disabled rather than left
        // clickable, so ticking it can never write an indexed: true that
        // the app then ignores.
        <p className="text-xs text-muted-foreground">
          Index to 100 is not available while stacking is on.
        </p>
      )}
    </div>
  )
}
