'use client'

import { useId } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import type { QueryResultColumn } from '@/lib/mock-data'

interface HeatmapEditorProps {
  options: Record<string, unknown>
  columns: QueryResultColumn[]
  onChange: (options: Record<string, unknown>) => void
}

const ROLES = [
  { value: '', label: '-- unused --' },
  { value: 'x', label: 'X (columns)' },
  { value: 'y', label: 'Y (rows)' },
  { value: 'value', label: 'Value' },
]

// How duplicate (x, y) cells combine. 'count' is the one that needs no value
// column, since it counts the rows landing in the cell.
const AGGREGATIONS = [
  { value: 'sum', label: 'Sum' },
  { value: 'count', label: 'Count rows' },
  { value: 'avg', label: 'Average' },
  { value: 'min', label: 'Min' },
  { value: 'max', label: 'Max' },
]

const SHOW_VALUES = [
  { value: 'auto', label: 'Auto (hide on dense grids)' },
  { value: 'always', label: 'Always' },
  { value: 'never', label: 'Never' },
]

const SORT_ROWS = [
  { value: 'none', label: 'Source order' },
  { value: 'total', label: 'By row total' },
  { value: 'peak', label: 'By peak cell' },
]

export function HeatmapEditor({ options, columns, onChange }: HeatmapEditorProps) {
  const columnMapping = (options.columnMapping as Record<string, string>) || {}
  // Every Select trigger here is a button, not a native select element, so a
  // sibling label with no htmlFor and no wrapping names nothing: the trigger
  // had no programmatic name at all, and a screen-reader user heard the
  // current value ("Never") with nothing about which option it controlled.
  // Ids come from useId so two editors mounted at once (the visualization
  // dialog can render one behind another) cannot collide, and the
  // column-mapping ones are keyed by INDEX rather than by column name, since
  // a column name can carry spaces and other characters an id should not.
  const labelId = useId()
  const aggregationId = `${labelId}-aggregation`
  const showValuesId = `${labelId}-show-values`
  const sortRowsId = `${labelId}-sort-rows`
  const clipOutliersId = `${labelId}-clip-outliers`

  const update = (key: string, value: unknown) => {
    onChange({ ...options, [key]: value })
  }

  const updateMapping = (col: string, role: string) => {
    const next = { ...columnMapping }
    if (role === '') {
      delete next[col]
    } else {
      next[col] = role
    }
    onChange({ ...options, columnMapping: next })
  }

  return (
    <div className="space-y-4">
      <div>
        {/* A heading over the repeated selects below, not a label for any one of them: each row already names itself via aria-labelledby. */}
        <div className="text-sm font-medium mb-2">Column Mapping</div>
        <div className="space-y-2">
          {columns.map((col, index) => (
            <div key={col.name} className="flex items-center gap-2">
              <span className="text-sm w-32 truncate" id={`${labelId}-column-${index}`} title={col.name}>{col.name}</span>
              <Select
                value={columnMapping[col.name] || ''}
                items={ROLES}
                onValueChange={(v) => updateMapping(col.name, v ?? '')}
              >
                <SelectTrigger className="flex-1 w-full h-7 text-xs" aria-labelledby={`${labelId}-column-${index}`}>
                  <SelectValue placeholder="-- unused --" />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((role) => (
                    <SelectItem key={role.value} value={role.value}>{role.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      </div>
      <div>
        <Label htmlFor={aggregationId} className="mb-1 block">Aggregation</Label>
        <Select
          value={(options.aggregation as string) || 'sum'}
          items={AGGREGATIONS}
          onValueChange={(v) => onChange({ ...options, aggregation: v ?? 'sum' })}
        >
          <SelectTrigger id={aggregationId} className="w-full h-8">
            <SelectValue placeholder="Sum" />
          </SelectTrigger>
          <SelectContent>
            {AGGREGATIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor={showValuesId} className="mb-1 block">Show values</Label>
        <Select
          value={(options.showValues as string) || 'auto'}
          items={SHOW_VALUES}
          onValueChange={(v) => update('showValues', v ?? 'auto')}
        >
          <SelectTrigger id={showValuesId} className="w-full h-8">
            <SelectValue placeholder="Auto (hide on dense grids)" />
          </SelectTrigger>
          <SelectContent>
            {SHOW_VALUES.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <div className="flex items-center gap-2 text-sm">
          <Checkbox
            id={clipOutliersId}
            checked={(options.clipOutliers as boolean) ?? false}
            onCheckedChange={(checked) => update('clipOutliers', checked)}
          />
          <Label htmlFor={clipOutliersId}>Clip outliers to the 2nd and 98th percentile</Label>
        </div>
        <p className="text-xs text-muted-foreground">
          One extreme cell stops compressing every other row into the bottom of the colour ramp.
          Out-of-range cells still render, clamped to the end colour.
        </p>
      </div>
      <div>
        <Label htmlFor={sortRowsId} className="mb-1 block">Sort rows</Label>
        <Select
          value={(options.sortRows as string) || 'none'}
          items={SORT_ROWS}
          onValueChange={(v) => update('sortRows', v ?? 'none')}
        >
          <SelectTrigger id={sortRowsId} className="w-full h-8">
            <SelectValue placeholder="Source order" />
          </SelectTrigger>
          <SelectContent>
            {SORT_ROWS.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
