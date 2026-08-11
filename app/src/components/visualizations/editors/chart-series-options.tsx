'use client'

// The per-series section of the chart editor: rename, palette color, shape and
// curve, written into `seriesOptions`, the same field a chart authored in
// Redash's own editor carries. The renderers have honored that field all along
// (line-area-chart draws combos from `type`, resolveSeriesColor reads `color`,
// curveTypeFor reads `curve`); this is the first place the product can author it.
//
// Every control follows the rule the indexed/reference-line work set: a shape
// only gets the controls its renderer actually reads. Rename reaches line, area
// and bar (their marks take `seriesOptions[name]?.name`); shape and curve only
// the line/area renderer, which is the one that draws combos; color reaches
// everything listed, including pie slices, whose colors key on the slice value.
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getChartPalette } from '@/lib/chart-colors'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import type { RedashChartOptions, RedashSeriesOptions } from '@/services/redash/types'
import type { ChartShape } from '@/components/visualizations/chart/chart-shape'
import {
  resolveChartConfig,
  rightAxisSeriesNamesFor,
  scatterSeriesKey,
  seriesNamesFor,
} from '@/components/visualizations/chart/resolve-config'

interface ChartSeriesOptionsProps {
  chartType: ChartShape
  options: RedashChartOptions
  data?: QueryResultData
  onChange: (seriesOptions: Record<string, RedashSeriesOptions>) => void
}

/**
 * The rows this section offers, derived through resolveChartConfig so the list
 * is exactly what the preview draws: mapped y columns fall back to the same
 * inference the renderer runs, a mapped series column contributes its distinct
 * values, and a pie contributes its slices.
 *
 * A scatter with no series column draws one anonymous group whose color keys on
 * the x column's name; that row is not offered rather than surfacing a control
 * labelled with a column that is not a series.
 */
export function editableSeriesNames(
  chartType: ChartShape,
  options: RedashChartOptions,
  data: QueryResultData | undefined
): string[] {
  if (!data) return []
  const probe: MockVisualization = {
    id: 0,
    type: 'CHART',
    name: '',
    description: '',
    options: options as Record<string, unknown>,
    created_at: '',
    updated_at: '',
  }
  const config = resolveChartConfig(probe, data)
  if (chartType === 'pie') {
    if (!config.xCol) return []
    return [...new Set(data.rows.map((row) => String(row[config.xCol])))]
  }
  if (chartType === 'scatter') {
    // Scatter groups by the shared scatterSeriesKey rule (null rows become the
    // Ungrouped label the renderer looks up), and draws no right-axis series.
    const seriesCol = config.seriesCol
    if (!seriesCol) return []
    return [...new Set(data.rows.map((row) => scatterSeriesKey(row[seriesCol])))]
  }
  // A swapped bar chart draws no right-axis series at all (bar-chart.tsx maps
  // them only in the horizontal layout), so their rows are not offered there.
  const rightAxis =
    chartType === 'bar' && config.swappedAxes ? [] : rightAxisSeriesNamesFor(config, data)
  return [...seriesNamesFor(config, data), ...rightAxis]
}

// 'column' is Redash's spelling for a bar mark and what its own editor stores,
// so writing it keeps a document round-trippable; the renderer reads both.
const SHAPE_ITEMS = [
  { value: '', label: 'Default' },
  { value: 'line', label: 'Line' },
  { value: 'column', label: 'Bar' },
  { value: 'area', label: 'Area' },
]

// The default curve is the renderer's monotone fallback (curveTypeFor), so it
// is not repeated as an explicit item.
const CURVE_ITEMS = [
  { value: '', label: 'Default (smooth)' },
  { value: 'linear', label: 'Linear' },
  { value: 'step', label: 'Step' },
  { value: 'natural', label: 'Natural' },
]

function withPatch(
  all: Record<string, RedashSeriesOptions>,
  series: string,
  patch: Partial<Record<keyof RedashSeriesOptions, string>>
): Record<string, RedashSeriesOptions> {
  const current: Record<string, unknown> = { ...(all[series] ?? {}) }
  for (const [key, value] of Object.entries(patch)) {
    if (value === '') delete current[key]
    else current[key] = value
  }
  const next = { ...all }
  if (Object.keys(current).length === 0) delete next[series]
  else next[series] = current as RedashSeriesOptions
  return next
}

export function ChartSeriesOptions({ chartType, options, data, onChange }: ChartSeriesOptionsProps) {
  const names = editableSeriesNames(chartType, options, data)
  if (names.length === 0) return null

  const seriesOptions = options.seriesOptions ?? {}
  const palette = getChartPalette()
  // Rename is honored by the line/area and bar marks; pie names slices from the
  // x column and scatter from the series value, so offering it there would be a
  // field the preview ignores.
  const offerRename = chartType === 'line' || chartType === 'area' || chartType === 'bar'
  // Only the line/area renderer draws per-series marks and curves.
  const offerShape = chartType === 'line' || chartType === 'area'

  const patch = (series: string, fields: Partial<Record<keyof RedashSeriesOptions, string>>) => {
    onChange(withPatch(seriesOptions, series, fields))
  }

  return (
    <div>
      {/* Heading over the rows; every control below names itself and its series. */}
      <div className="text-sm font-medium mb-2">Series</div>
      <div className="space-y-3">
        {names.map((name) => {
          const stored = seriesOptions[name] ?? {}
          const color = stored.color ?? ''
          // A stored value outside the palette (a hex written by Redash's own
          // color picker) stays selectable as itself, so opening this editor
          // never silently discards it.
          const isCustomColor = color !== '' && !palette.includes(color)
          const storedType = stored.type === 'bar' ? 'column' : (stored.type ?? '')
          return (
            <div key={name} className="space-y-1">
              <div className="text-xs text-muted-foreground truncate" title={name}>
                {name}
              </div>
              <div className="flex items-center gap-1">
                {offerRename && (
                  <Input
                    aria-label={`Rename ${name}`}
                    value={stored.name ?? ''}
                    placeholder={name}
                    onChange={(event) => patch(name, { name: event.target.value })}
                    className="h-7 flex-1 text-xs"
                  />
                )}
                <Select value={color} onValueChange={(value) => patch(name, { color: value ?? '' })}>
                  <SelectTrigger
                    aria-label={`Color for ${name}`}
                    className={`h-7 text-xs ${offerRename ? 'w-28 shrink-0' : 'flex-1 w-full'}`}
                  >
                    <SelectValue placeholder="Automatic" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Automatic</SelectItem>
                    {palette.map((slot, i) => (
                      <SelectItem key={slot} value={slot}>
                        <span
                          aria-hidden
                          className="mr-1 inline-block size-3 rounded-sm border border-border align-[-1px]"
                          style={{ background: slot }}
                        />
                        Color {i + 1}
                      </SelectItem>
                    ))}
                    {isCustomColor && (
                      <SelectItem value={color}>
                        <span
                          aria-hidden
                          className="mr-1 inline-block size-3 rounded-sm border border-border align-[-1px]"
                          style={{ background: color }}
                        />
                        Custom ({color})
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              {offerShape && (
                <div className="flex items-center gap-1">
                  <Select
                    value={storedType}
                    onValueChange={(value) => patch(name, { type: value ?? '' })}
                  >
                    <SelectTrigger aria-label={`Shape for ${name}`} className="h-7 flex-1 w-full text-xs">
                      <SelectValue placeholder="Default" />
                    </SelectTrigger>
                    <SelectContent>
                      {SHAPE_ITEMS.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={stored.curve ?? ''}
                    onValueChange={(value) => patch(name, { curve: value ?? '' })}
                  >
                    <SelectTrigger aria-label={`Curve for ${name}`} className="h-7 flex-1 w-full text-xs">
                      <SelectValue placeholder="Default (smooth)" />
                    </SelectTrigger>
                    <SelectContent>
                      {CURVE_ITEMS.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
