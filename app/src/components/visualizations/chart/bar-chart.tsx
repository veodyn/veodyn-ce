'use client'

import { useMemo } from 'react'
import {
  Bar, BarChart as RechartsBarChart, CartesianGrid, LabelList, Legend,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { formatCompactNumber, formatLabelValue } from '@/lib/chart-format'
import type { DisplayPatterns } from '@/lib/date-pattern'
import { resolveSeriesColor } from '@/lib/chart-colors'
import { BAND_CURSOR, BAR_GAP, CHART_INITIAL_DIMENSION, MAX_BAR_SIZE, STACK_SEGMENT_GAP, barRadius, hasNegativeValue } from '@/lib/chart-marks'
import { ChartTooltip } from './chart-tooltip'
import { ChartLegend } from './chart-legend'
import { ChartFrame } from './chart-frame'
import { chartSummary } from './chart-summary'
import { SERIES_ANIMATION } from './animation'
import { rightAxisSeriesNamesFor, seriesNamesFor, type ResolvedChartConfig } from './resolve-config'
import { AXIS_LINE, AXIS_TICK, BASELINE_VALUE_DOMAIN, GRID, indexedXAxisLabel, indexedYAxisLabel, referenceLinesFor, yAxisPropsFor } from './axis-config'
import { planXAxis } from './x-axis-config'
import type { QueryResultData } from '@/lib/mock-data'

interface BarChartRendererProps {
  config: ResolvedChartConfig
  chartData: Record<string, unknown>[]
  data: QueryResultData
  /** The display formats from Settings > Formats (see ChartRenderer). */
  patterns: DisplayPatterns
}

export function BarChart({ config, chartData, data, patterns }: BarChartRendererProps) {
  const seriesNames = seriesNamesFor(config, data)
  const leftAxis = yAxisPropsFor(0, config)
  const stackId = config.stacking !== 'disabled' ? 'stack' : undefined
  const isPercent = config.stacking === 'percent'
  const valueFormatter = isPercent ? (v: number) => `${formatCompactNumber(v)}%` : formatCompactNumber
  const layout = config.swappedAxes ? 'vertical' : 'horizontal'
  // Bars size themselves against a category band, so the x axis stays
  // categorical here and only takes the span-aware tick labels. In categorical
  // mode the plan hands back the same rows it was given, so the table twin and
  // the summary below read the same values either way.
  const xAxis = useMemo(
    () => planXAxis(config, chartData, patterns, { categorical: true }),
    [config, chartData, patterns],
  )
  // The right-axis series only draw as their own Bars in horizontal layout
  // (see below), so the legend condition and the frame's reserved band both
  // need this combined count, not seriesNames.length alone, or that series
  // draws a bar with no legend entry and no room reserved for it.
  // rightAxisSeriesNamesFor expands to one name per (series, right column)
  // pair once a series column pivots the chart (see resolve-config.ts).
  const rightAxisSeriesNames = rightAxisSeriesNamesFor(config, data)
  const legendSeriesCount = seriesNames.length + (layout === 'horizontal' ? rightAxisSeriesNames.length : 0)
  // The summary must describe exactly what this chart draws: the
  // right-axis series only render as Bars in horizontal layout (below), so a
  // vertical (swapped) layout must drop them too, or the summary would report
  // a range taken from a series the chart never draws.
  const summarySeriesNames = layout === 'horizontal' ? [...seriesNames, ...rightAxisSeriesNames] : seriesNames
  const summary = chartSummary(config, chartData, summarySeriesNames, patterns)
  // Whether the rounded data-end is honest on this chart: recharts rounds the
  // same corners at either sign, so one negative anywhere squares every bar
  // rather than rounding a corner that sits on the baseline. Keyed on the
  // series list as a string, since the array itself is rebuilt every render.
  const hasNegative = useMemo(
    () => hasNegativeValue(chartData, summarySeriesNames),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chartData, JSON.stringify(summarySeriesNames)]
  )
  // Only a stack has touching segments to separate; a grouped chart already
  // has BAR_GAP between its bars, and stroking them there would shave a pixel
  // off both sides of each one for nothing.
  const stackGap = stackId ? STACK_SEGMENT_GAP : undefined

  return (
    <ChartFrame
      seriesCount={legendSeriesCount}
      hasAxisBand
      summary={summary}
    >
      <ResponsiveContainer initialDimension={CHART_INITIAL_DIMENSION}>
        <RechartsBarChart data={xAxis.data} layout={layout} barGap={BAR_GAP} maxBarSize={MAX_BAR_SIZE}>
          <CartesianGrid {...GRID} />
          {layout === 'vertical' ? (
            <>
              {/* The value axis runs along the bottom in this layout, so the
                  headroom every other value axis takes at the top of the plot
                  is taken at its right-hand end instead. Bars draw from a
                  baseline, so this one keeps the 0 floor recharts gives it by
                  default rather than the data-derived floor yAxisPropsFor
                  picks, which would cut the bars off at their own minimum. */}
              <XAxis
                type="number"
                domain={BASELINE_VALUE_DOMAIN}
                niceTicks="none"
                {...AXIS_LINE}
                tick={AXIS_TICK}
                tickFormatter={valueFormatter}
                label={config.indexed ? indexedXAxisLabel() : undefined}
              />
              <YAxis
                type="category"
                dataKey={config.xCol}
                {...AXIS_LINE}
                tick={AXIS_TICK}
                width={100}
              />
            </>
          ) : (
            <>
              {/* The plan decides what this axis MEANS (its dataKey and its
                  span-aware tick labels); the chrome tokens come after it and
                  win on presentation. A categorical plan never returns a tick
                  element, only the styling object the tokens replace here. */}
              <XAxis {...xAxis.props} {...AXIS_LINE} tick={AXIS_TICK} />
              <YAxis
                {...AXIS_LINE}
                tick={AXIS_TICK}
                scale={isPercent ? 'linear' : leftAxis.scale}
                domain={isPercent ? [0, 100] : leftAxis.domain}
                niceTicks={leftAxis.niceTicks}
                tickFormatter={valueFormatter}
                label={config.indexed ? indexedYAxisLabel() : undefined}
              />
            </>
          )}
          <Tooltip
            cursor={BAND_CURSOR}
            content={<ChartTooltip xIsDatetime={config.xIsDatetime} xHasTime={config.xHasTime} patterns={patterns} valueFormatter={valueFormatter} />}
          />
          {legendSeriesCount >= 2 && <Legend content={<ChartLegend />} />}
          {layout === 'horizontal' && referenceLinesFor(config).map((line, i) => (
            <ReferenceLine
              key={i}
              y={line.axis === 'x' ? undefined : line.value}
              x={line.axis === 'x' ? line.value : undefined}
              label={line.label}
              stroke={line.color ?? 'var(--muted-foreground)'}
              strokeDasharray="4 4"
            />
          ))}
          {seriesNames.map((name, i) => (
            <Bar
              key={name}
              dataKey={name}
              name={config.seriesOptions[name]?.name ?? name}
              fill={resolveSeriesColor(name, i, { seriesOptions: config.seriesOptions })}
              stackId={stackId}
              // In a stack only the topmost segment ends the bar; every other
              // one has a neighbour sitting on it and stays square.
              radius={barRadius({ layout, isDataEnd: stackId == null || i === seriesNames.length - 1, hasNegative })}
              {...stackGap}
              {...SERIES_ANIMATION}
            >
              {config.showDataLabels && (
                <LabelList
                  position={layout === 'vertical' ? 'right' : 'top'}
                  formatter={(value) => (typeof value === 'number' ? valueFormatter(value) : formatLabelValue(value))}
                />
              )}
            </Bar>
          ))}
          {layout === 'horizontal' && rightAxisSeriesNames.map((name, i) => (
            <Bar
              key={name}
              dataKey={name}
              name={config.seriesOptions[name]?.name ?? name}
              fill={resolveSeriesColor(name, seriesNames.length + i, { seriesOptions: config.seriesOptions })}
              // Never stacked (no stackId above), so every one of these is its
              // own whole bar and ends in a rounded cap.
              radius={barRadius({ layout, isDataEnd: true, hasNegative })}
              {...SERIES_ANIMATION}
            />
          ))}
        </RechartsBarChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}
