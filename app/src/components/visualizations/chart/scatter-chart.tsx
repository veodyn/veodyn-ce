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

// The two ends of a bubble's size channel, in the unit recharts actually wants:
// the symbol's AREA in square pixels, not its radius (Scatter derives
// radius = sqrt(size / PI) from it). Area is also the channel to encode into,
// since that is the quantity the eye compares between two discs.
//
// The low end is recharts' own default mark area (its implicit z-axis range is
// [64, 64], radius ~4.5), so the smallest bubble is exactly the dot a plain
// scatter draws and never shrinks to something unhoverable. The high end is 16x
// that area, radius ~18, which is the largest mark that still reads as a
// measurement in a 400px plot rather than as overlapping blobs.
//
// Deliberately a scale rather than Redash's own arithmetic. Plotly takes the
// raw cell as a pixel diameter times a coefficient (prepareBubbleSeries in the
// fork), so a size column of ratios draws points too small to see and one of
// revenue figures draws a single disc over the whole plot. Mapping the column's
// own range onto a fixed range of areas reads the same whatever its units are.
const BUBBLE_SIZE_RANGE = [64, 1024] as const

// Anchored at zero, so a mark's area reads against the origin the way the value
// does: twice the value is twice the area above the floor, and a row whose size
// value is 0 still draws, at the smallest mark rather than at no mark. Scaling
// from dataMin instead would hand the smallest point in the result the floor
// however close to the largest it is, redrawing a 99-to-100 spread as the same
// picture as a 1-to-100 one.
//
// The anchor holds because resolveChartConfig withholds sizeCol for a column
// carrying a negative value, NOT because recharts honours this floor. It does
// not: ZAxis passes implicitZAxis.allowDataOverflow, a hardcoded false, in place
// of any prop, and extendDomain then grows a user domain to cover the data
// rather than clipping the data to it, so one negative row would quietly
// replace this 0 with dataMin. Asserted against the installed recharts, where
// sizes of -10, -1, 0 and 1 drew areas of 64, 849, 64 and 1024.
//
// Scatter's other rule, that an exact 0 is "no z value" and takes range[0],
// survives that and is harmless: range[0] is where this domain maps 0 anyway,
// so the special case and the scale agree rather than drawing one value at two
// sizes. It is why the range floor and the unsized mark have to stay one number.
//
// 'dataMax' rather than recharts' own 'auto' default, which resolves to the data
// max on an axis with no ticks to round for but DOES round on the x and y axes,
// so inheriting it would make the top of this scale depend on a rounding rule
// that has nothing to do with size. scatter-chart.bubble.test.tsx pins all of it.
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
  // ELEMENT from the plan is the time axis's own two-line renderer (the label
  // plus the date it sits under), not styling, so swapping in the token
  // object would drop the context line and the formatted label with it.
  const xTick = isValidElement(xAxis.props.tick) ? xAxis.props.tick : AXIS_TICK

  const seriesGroups = config.seriesCol
    ? groupBy(xAxis.data, config.seriesCol)
    : new Map([['', xAxis.data]])

  // Every row in data.rows carries the yCol key regardless of grouping, so
  // the summary is computed straight off it rather than off any pivot: a
  // single series name, [yCol], describes the one value column every point
  // shares.
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
          {/* The plan owns what this axis means (its dataKey, and its scale
              and ticks once the x column is temporal); the chrome tokens come
              after it and win on presentation. See xTick above for the one
              prop the tokens do not take over. */}
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
          {/* What makes a bubble chart a bubble chart. A virtual axis: it draws
              no ticks and no line of its own, it only sizes the marks below.
              Mounted only when config.sizeCol is set, which resolveChartConfig
              limits to a column the result has and can encode as an area, so a
              plain scatter keeps drawing the uniform dots it always drew rather
              than depending on this range's low end happening to match. */}
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

// A row whose series column is null or missing must not surface as the
// literal string "undefined" in the legend: that reads as a bug, not a
// category. Grouped under one honest label instead, via the shared rule in
// resolve-config so the editor's per-series section lists exactly the group
// names these seriesOptions lookups will use.
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
