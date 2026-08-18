'use client'

import { isValidElement, useMemo } from 'react'
import {
  CartesianGrid, Legend, ReferenceLine, ResponsiveContainer,
  Scatter, ScatterChart as RechartsScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts'
import { formatCompactNumber } from '@/lib/chart-format'
import type { DisplayPatterns } from '@/lib/date-pattern'
import { resolveSeriesColor } from '@/lib/chart-colors'
import { AXIS_CURSOR, CHART_INITIAL_DIMENSION } from '@/lib/chart-marks'
import { ChartTooltip } from './chart-tooltip'
import { ChartLegend } from './chart-legend'
import { ChartFrame } from './chart-frame'
import { chartSummary } from './chart-summary'
import { SERIES_ANIMATION } from './animation'
import { scatterSeriesKey, type ResolvedChartConfig } from './resolve-config'
import { AXIS_LINE, AXIS_TICK, GRID, referenceLinesFor, yAxisPropsFor } from './axis-config'
import { planXAxis } from './x-axis-config'
import type { QueryResultData } from '@/lib/mock-data'

// The two ends of a bubble's size channel, in square pixels of mark AREA, not
// radius (Scatter derives radius = sqrt(size / PI)). 64 is recharts' own default
// mark area (its implicit z-axis range is [64, 64], radius ~4.5), so the
// smallest bubble is the dot a plain scatter draws; 1024 is 16x that, radius
// ~18, the largest mark that still reads as a measurement in a 400px plot.
// Mapping the column's range onto fixed areas reads the same whatever its units
// are, unlike Plotly's raw-cell-as-pixel-diameter arithmetic.
const BUBBLE_SIZE_RANGE = [64, 1024] as const

// Anchored at zero, so twice the value is twice the area above the floor and a
// size of 0 still draws at the smallest mark. Scaling from dataMin instead would
// redraw a 99-to-100 spread as the same picture as a 1-to-100 one.
//
// The anchor holds because resolveChartConfig withholds sizeCol for a column
// carrying a negative value, NOT because recharts honours this floor: ZAxis
// passes a hardcoded allowDataOverflow: false, and extendDomain then grows the
// domain to cover the data rather than clipping it, so one negative row replaces
// this 0 with dataMin (measured: sizes -10, -1, 0, 1 drew areas 64, 849, 64, 1024).
//
// Scatter also reads an exact 0 as "no z value" and gives it range[0], which is
// where this domain maps 0 anyway, so the range floor and the unsized mark have
// to stay one number.
//
// 'dataMax' rather than recharts' 'auto' default, which rounds on the x and y
// axes, so inheriting it would tie the top of this scale to a rounding rule that
// has nothing to do with size. scatter-chart.bubble.test.tsx pins all of it.
const BUBBLE_SIZE_DOMAIN = [0, 'dataMax'] as const

interface ScatterChartRendererProps {
  config: ResolvedChartConfig
  data: QueryResultData
  /** The display formats from Settings > Formats (see ChartRenderer). */
  patterns: DisplayPatterns
}

export function ScatterChart({ config, data, patterns }: ScatterChartRendererProps) {
  const yCol = config.effectiveYCols[0]
  const leftAxis = yAxisPropsFor(0, config)
  const xAxis = useMemo(() => planXAxis(config, data.rows, patterns), [config, data.rows, patterns])
  // Chrome tokens win over the plan's styling, with one exception: a tick
  // ELEMENT from the plan is the time axis's two-line renderer, not styling, so
  // the token object would drop the context line and the formatted label.
  const xTick = isValidElement(xAxis.props.tick) ? xAxis.props.tick : AXIS_TICK

  const seriesGroups = config.seriesCol
    ? groupBy(xAxis.data, config.seriesCol)
    : new Map([['', xAxis.data]])

  // Every row in data.rows carries the yCol key regardless of grouping, so the
  // summary comes straight off it rather than off any pivot.
  const summary = chartSummary(config, data.rows, [yCol], patterns)

  return (
    <ChartFrame
      seriesCount={seriesGroups.size}
      hasAxisBand
      summary={summary}
    >
      <ResponsiveContainer initialDimension={CHART_INITIAL_DIMENSION}>
        <RechartsScatterChart>
          <CartesianGrid {...GRID} />
          {/* The plan owns what this axis means (dataKey, plus scale and ticks
              once the x column is temporal); the chrome tokens come after it and
              win on presentation, except for xTick above. */}
          <XAxis {...xAxis.props} {...AXIS_LINE} tick={xTick} />
          <YAxis
            dataKey={yCol}
            {...AXIS_LINE}
            tick={AXIS_TICK}
            scale={leftAxis.scale}
            domain={leftAxis.domain}
            niceTicks={leftAxis.niceTicks}
            tickFormatter={formatCompactNumber}
          />
          {/* A virtual axis: it draws no ticks and no line, it only sizes the
              marks below. Mounted only when config.sizeCol is set, so a plain
              scatter keeps drawing uniform dots rather than depending on this
              range's low end happening to match. */}
          {config.sizeCol != null && (
            <ZAxis
              dataKey={config.sizeCol}
              type="number"
              domain={BUBBLE_SIZE_DOMAIN}
              range={BUBBLE_SIZE_RANGE}
            />
          )}
          {/* Scatter's cursor draws as a cross through the hovered point, so
              it takes the same hairline token the crosshair charts do. */}
          <Tooltip
            cursor={AXIS_CURSOR}
            content={<ChartTooltip xIsDatetime={config.xIsDatetime} xHasTime={config.xHasTime} patterns={patterns} />}
          />
          {seriesGroups.size >= 2 && <Legend content={<ChartLegend />} />}
          {referenceLinesFor(config).map((line, i) => (
            <ReferenceLine
              key={i}
              y={line.axis === 'x' ? undefined : line.value}
              x={line.axis === 'x' ? xAxis.toAxisValue(line.value) : undefined}
              label={line.label}
              stroke={line.color ?? 'var(--muted-foreground)'}
              strokeDasharray="4 4"
            />
          ))}
          {Array.from(seriesGroups.entries()).map(([name, rows], i) => (
            <Scatter
              key={name || 'default'}
              name={name || undefined}
              data={rows}
              fill={resolveSeriesColor(name || config.xCol, i, { seriesOptions: config.seriesOptions })}
              {...SERIES_ANIMATION}
            />
          ))}
        </RechartsScatterChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}

// A row whose series column is null or missing must not surface as the literal
// string "undefined" in the legend. The shared rule in resolve-config names
// those groups, so the editor's per-series section lists the same keys these
// seriesOptions lookups use.
function groupBy(rows: Record<string, unknown>[], key: string): Map<string, Record<string, unknown>[]> {
  const groups = new Map<string, Record<string, unknown>[]>()
  for (const row of rows) {
    const groupKey = scatterSeriesKey(row[key])
    const bucket = groups.get(groupKey) ?? []
    bucket.push(row)
    groups.set(groupKey, bucket)
  }
  return groups
}
