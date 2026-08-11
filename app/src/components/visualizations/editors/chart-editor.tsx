'use client'

import { useId } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/shared/icon-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { QueryResultColumn, QueryResultData } from '@/lib/mock-data'
import type { RedashAxisOptions, RedashChartOptions, RedashReferenceLine } from '@/services/redash/types'
import { resolveChartShape } from '@/components/visualizations/chart/chart-shape'
import { effectiveIndexed } from '@/components/visualizations/chart/resolve-config'
import { ChartSeriesOptions } from './chart-series-options'
import { ChartXAxisOptions } from './chart-x-axis-options'
import { ChartYAxisOptions } from './chart-y-axis-options'

interface ChartEditorProps {
  options: Record<string, unknown>
  columns: QueryResultColumn[]
  data?: QueryResultData
  onChange: (options: Record<string, unknown>) => void
}

const CHART_TYPES = ['line', 'bar', 'area', 'pie', 'scatter'] as const

// 'yRight' used to feed a second y-scale; phase 3 removed dual-axis
// rendering, so a column with this role now renders as an ordinary extra
// series on the one shared axis (indexed alongside the rest when the chart
// is indexed). The role and its stored value are unchanged, so a saved
// visualization still resolves the same way; only the label changed, so it
// stops promising an axis this chart no longer draws.
const MAPPING_ROLES = [
  { value: '', label: '-- unused --' },
  { value: 'x', label: 'X Axis' },
  { value: 'y', label: 'Y Axis' },
  { value: 'series', label: 'Series' },
  { value: 'yRight', label: 'Y Axis (extra series)' },
]

export function ChartEditor({ options: rawOptions, columns, data, onChange }: ChartEditorProps) {
  // Tied to the controls they name. Left loose these were text above a widget,
  // so a screen reader announced two unnamed buttons, and the dialog next door
  // already fixed the same thing for its Type and Name.
  const chartTypeId = useId()
  const stackingId = useId()
  const horizontalBarsId = useId()
  const donutId = useId()
  const showDataLabelsId = useId()
  const options = rawOptions as RedashChartOptions
  // The resolved shape, not the raw option. A chart authored in Redash stores
  // 'column', which is not one of CHART_TYPES, so the raw value left the Type
  // select showing an option it does not offer and hid the bar-only controls
  // below while the renderer drew bars. Reading the same mapping the renderer
  // reads keeps the editor describing the chart on screen.
  //
  // Display only: nothing is written back, so the stored 'column' survives
  // untouched until someone actually picks a different type.
  const chartType = resolveChartShape(options.globalSeriesType)
  const columnMapping = options.columnMapping || {}
  const stacking = options.series?.stacking ?? (options.stacking === 'stack' ? 'stack' : 'disabled')
  const yAxis = options.yAxis ?? []
  const referenceLines = options.referenceLines ?? []
  // The single source of truth for "is this chart actually indexed" (shared
  // with resolveChartConfig), reused here to decide which controls the
  // renderer will actually honour. yAxisPropsFor (axis-config.ts) forces
  // linear/auto-range on an indexed chart regardless of what's stored here,
  // and referenceLinesFor drops every reference line this editor can create
  // (it never offers a way to mark one as an x-axis line, the only kind that
  // survives indexing). A control that cannot take effect must say so rather
  // than sit there as if it works.
  const indexed = effectiveIndexed(options)

  const update = (key: string, value: unknown) => {
    onChange({ ...rawOptions, [key]: value })
  }

  const updateMapping = (col: string, role: string) => {
    const next = { ...columnMapping }
    if (role === '') {
      delete next[col]
    } else {
      next[col] = role as never
    }
    update('columnMapping', next)
  }

  const updateAxis = (patch: Partial<RedashAxisOptions>) => {
    const next = [...yAxis]
    next[0] = { ...next[0], ...patch }
    update('yAxis', next)
  }

  const addReferenceLine = () => {
    update('referenceLines', [...referenceLines, { value: 0, label: '' } satisfies RedashReferenceLine])
  }

  const updateReferenceLine = (index: number, patch: Partial<RedashReferenceLine>) => {
    const next = referenceLines.map((line, i) => (i === index ? { ...line, ...patch } : line))
    update('referenceLines', next)
  }

  const removeReferenceLine = (index: number) => {
    update('referenceLines', referenceLines.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor={chartTypeId} className="mb-1 block">Chart Type</Label>
        <Select value={chartType} onValueChange={(v) => update('globalSeriesType', v)}>
          <SelectTrigger id={chartTypeId} className="w-full h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CHART_TYPES.map((t) => (
              <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        {/* A heading over the repeated selects below, not a label for any one of them: each row already names itself via aria-label. */}
        <div className="text-sm font-medium mb-2">Column Mapping</div>
        <div className="space-y-2">
          {columns.map((col) => (
            <div key={col.name} className="flex items-center gap-2">
              <span className="text-sm w-32 truncate" title={col.name}>{col.name}</span>
              <Select
                value={columnMapping[col.name] || ''}
                onValueChange={(v) => updateMapping(col.name, v ?? '')}
              >
                {/* The column name beside it is a span, not a label, so without
                    this each of these reads as an unnamed button: a row of
                    identical selects with nothing saying which column each one
                    is for. */}
                <SelectTrigger
                  aria-label={`Role for ${col.name}`}
                  className="flex-1 w-full h-7 text-xs"
                >
                  <SelectValue placeholder="-- unused --" />
                </SelectTrigger>
                <SelectContent>
                  {MAPPING_ROLES.map((role) => (
                    <SelectItem key={role.value} value={role.value}>{role.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      </div>

      {(chartType === 'bar' || chartType === 'area') && (
        <div>
          <Label htmlFor={stackingId} className="mb-1 block">Stacking</Label>
          <Select
            value={stacking}
            onValueChange={(v) => update('series', { ...options.series, stacking: v })}
          >
            <SelectTrigger id={stackingId} className="w-full h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="disabled">Disabled</SelectItem>
              <SelectItem value="stack">Stack</SelectItem>
              <SelectItem value="percent">Percent</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {chartType === 'bar' && (
        <div className="flex items-center gap-2 text-sm">
          <Checkbox id={horizontalBarsId} checked={options.swappedAxes ?? false} onCheckedChange={(checked) => update('swappedAxes', checked)} />
          <Label htmlFor={horizontalBarsId}>Horizontal bars (swap axes)</Label>
        </div>
      )}

      {chartType === 'pie' && (
        <div className="flex items-center gap-2 text-sm">
          <Checkbox id={donutId} checked={options.donut ?? false} onCheckedChange={(checked) => update('donut', checked)} />
          <Label htmlFor={donutId}>Donut</Label>
        </div>
      )}

      <ChartSeriesOptions
        chartType={chartType}
        options={options}
        data={data}
        onChange={(seriesOptions) => update('seriesOptions', seriesOptions)}
      />

      <ChartXAxisOptions
        chartType={chartType}
        xAxis={options.xAxis}
        reverseX={options.reverseX ?? false}
        onXAxisTypeChange={(type) => update('xAxis', { ...options.xAxis, type })}
        onReverseXChange={(checked) => update('reverseX', checked)}
      />

      {chartType !== 'pie' && (
        <ChartYAxisOptions
          chartType={chartType}
          yAxis={yAxis}
          indexed={indexed}
          stacking={stacking}
          onUpdateAxis={updateAxis}
          onIndexedChange={(checked) => update('indexed', checked)}
        />
      )}

      {chartType !== 'pie' && (
        <div>
          <div className="flex items-center justify-between mb-1">
            {/* Heading for the list below, not a label for the "+ Add" button or any one line's inputs; each already names itself. */}
            <div className="text-sm font-medium">Reference Lines</div>
            <Button
              variant="link"
              size="xs"
              onClick={addReferenceLine}
              className="h-auto p-0 text-xs"
              disabled={indexed}
            >
              + Add
            </Button>
          </div>
          <div className="space-y-1">
            {referenceLines.map((line, i) => (
              <div key={i} className="flex items-center gap-1">
                <Input
                  type="number"
                  value={line.value}
                  onChange={(e) => updateReferenceLine(i, { value: Number(e.target.value) })}
                  className="w-20 h-7 text-xs"
                  disabled={indexed}
                />
                <Input
                  type="text"
                  placeholder="label"
                  value={line.label ?? ''}
                  onChange={(e) => updateReferenceLine(i, { label: e.target.value })}
                  className="flex-1 h-7 text-xs"
                  disabled={indexed}
                />
                <IconButton
                  tooltip="Remove reference line"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => removeReferenceLine(i)}
                  className="text-destructive hover:text-destructive"
                  disabled={indexed}
                >
                  &#10005;
                </IconButton>
              </div>
            ))}
          </div>
          {indexed && (
            // referenceLinesFor (axis-config.ts) drops every reference line
            // this editor can create once the chart is indexed: it never
            // offers a way to mark one as an x-axis line, the only kind that
            // survives (each series has its own base once indexed, so a
            // y-position threshold no longer has one correct place to sit).
            <p className="text-xs text-muted-foreground mt-1">
              Reference lines are dropped on an indexed chart, so they cannot be added or edited here.
            </p>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 text-sm">
        <Checkbox id={showDataLabelsId} checked={options.showDataLabels ?? false} onCheckedChange={(checked) => update('showDataLabels', checked)} />
        <Label htmlFor={showDataLabelsId}>Show data labels</Label>
      </div>
    </div>
  )
}
