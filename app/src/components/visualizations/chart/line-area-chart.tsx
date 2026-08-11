'use client'

import { isValidElement, useMemo } from 'react'
import {
  Area, Bar, CartesianGrid, ComposedChart, Legend, Line, LabelList,
  ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { formatCompactNumber, formatLabelValue } from '@/lib/chart-format'
import type { DisplayPatterns } from '@/lib/date-pattern'
import { resolveSeriesColor } from '@/lib/chart-colors'
import { ACTIVE_DOT, AREA_FILL_OPACITY, AXIS_CURSOR, CHART_INITIAL_DIMENSION, LINE_MARK } from '@/lib/chart-marks'
import { ChartTooltip } from './chart-tooltip'
import { ChartLegend } from './chart-legend'
import { ChartFrame } from './chart-frame'
import { chartSummary } from './chart-summary'
import { downsampleRows } from './downsample'
import { SERIES_ANIMATION } from './animation'
import { curveTypeFor, rightAxisSeriesNamesFor, seriesNamesFor, type ResolvedChartConfig } from './resolve-config'
import { ANNOTATION_LABEL_FONT_SIZE, AXIS_LINE, AXIS_TICK, GRID, indexedYAxisLabel, referenceLinesFor, yAxisPropsFor } from './axis-config'
import { planXAxis } from './x-axis-config'
import type { QueryResultData } from '@/lib/mock-data'
import type { PlacedAnnotation } from '@/lib/annotation-overlay'

// Recharts centres every annotation label on the same baseline and does not
// clip it, so two annotations near each other overprint into an unreadable
// string that runs past the plot. Stagger them down a few rows and cap the
// length instead.
const ANNOTATION_LABEL_MAX = 28
const ANNOTATION_LABEL_ROWS = 3

export function annotationLabel(text: string, index: number) {
  return {
    value:
      text.length > ANNOTATION_LABEL_MAX ? `${text.slice(0, ANNOTATION_LABEL_MAX - 1)}…` : text,
    position: 'insideTopLeft' as const,
    offset: 8 + (index % ANNOTATION_LABEL_ROWS) * 16,
    fill: 'var(--muted-foreground)',
    fontSize: ANNOTATION_LABEL_FONT_SIZE,
  }
}


interface LineAreaChartProps {
  variant: 'line' | 'area'
  config: ResolvedChartConfig
  chartData: Record<string, unknown>[]
  data: QueryResultData
  annotations?: PlacedAnnotation[]
  /** The display formats from Settings > Formats (see ChartRenderer). */
  patterns: DisplayPatterns
}

export function LineAreaChart({ variant, config, chartData, data, annotations, patterns }: LineAreaChartProps) {
  const seriesNames = seriesNamesFor(config, data)
  // The right-axis series render as their own coloured series below (a
  // second, separate path from seriesNames, used only by columnMapping's
  // explicit 'yRight' slot). rightAxisSeriesNamesFor expands to one name per
  // (series, right column) pair once a series column pivots the chart, since
  // a bare right-axis column name no longer has one unambiguous value per x
  // then (see resolve-config.ts). The legend condition and the frame's
  // reserved band both need this combined count, not seriesNames.length
  // alone, or that series draws a line with no legend entry and no room
  // reserved for it.
  const rightAxisSeriesNames = rightAxisSeriesNamesFor(config, data)
  const legendSeriesCount = seriesNames.length + rightAxisSeriesNames.length
  // The summary must describe exactly what this chart draws: every name
  // in seriesNames plus every right-axis series name, since both render as
  // their own Area or Line below.
  const summarySeriesNames = [...seriesNames, ...rightAxisSeriesNames]
  // Drawn rows, which on a dense capture is far fewer than the query returned.
  // Every one of them is a real row and every series keeps its own highest and
  // lowest, so this thins the overdraw without changing what the chart claims.
  // Memoized because planXAxis below depends on it: downsampling allocates a
  // new array, so an unmemoized call would rebuild the whole axis plan, ticks
  // and all, on every render.
  const plotted = useMemo(
    () => downsampleRows(chartData, summarySeriesNames),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chartData, summarySeriesNames.join('\u0000')]
  )
  // From the full rows rather than the drawn ones. The downsampler pins every
  // series' peak and trough, so today the two agree; reading the full set
  // anyway means the summary stays true if that guarantee is ever relaxed,
  // and it is the only route to the numbers for a reader without the plot.
  const summary = chartSummary(config, chartData, summarySeriesNames, patterns)
  const leftAxis = yAxisPropsFor(0, config)
  const stackId = config.stacking !== 'disabled' ? 'stack' : undefined
  // A date x column moves onto a time scale here, which also moves annotations
  // and reference lines into epoch coordinates (xAxis.toAxisValue).
  const xAxis = useMemo(() => planXAxis(config, plotted, patterns), [config, plotted, patterns])
  // Chrome tokens win over the plan's styling, with one exception: when the
  // plan hands back a tick ELEMENT it is the time axis's own two-line
  // renderer (the label plus the date it sits under), not styling, and
  // replacing that with the token object would drop the context line and put
  // the axis back on raw tick text. It already draws at the token size and
  // colour; only tabular figures differ, and a time label has no columns of
  // digits to align.
  const xTick = isValidElement(xAxis.props.tick) ? xAxis.props.tick : AXIS_TICK

  return (
    <ChartFrame
      seriesCount={legendSeriesCount}
      hasAxisBand
      summary={summary}
    >
      <ResponsiveContainer initialDimension={CHART_INITIAL_DIMENSION}>
        {/* xAxis.data, not chartData: a datetime x column is plotted against a
            numeric mirror the plan adds per row, so drawing the raw rows here
            would leave the marks and the axis in different coordinates. */}
        <ComposedChart data={xAxis.data}>
          <CartesianGrid {...GRID} />
          <XAxis {...xAxis.props} {...AXIS_LINE} tick={xTick} />
          <YAxis
            {...AXIS_LINE}
            tick={AXIS_TICK}
            scale={leftAxis.scale}
            domain={leftAxis.domain}
            niceTicks={leftAxis.niceTicks}
            tickFormatter={formatCompactNumber}
            label={config.indexed ? indexedYAxisLabel() : undefined}
          />
          <Tooltip
            cursor={AXIS_CURSOR}
            content={<ChartTooltip xIsDatetime={config.xIsDatetime} xHasTime={config.xHasTime} patterns={patterns} />}
          />
          {legendSeriesCount >= 2 && <Legend content={<ChartLegend />} />}
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
          {annotations?.map((annotation, i) =>
            annotation.x2 == null ? (
              <ReferenceLine
                key={`anno-${annotation.id}`}
                // Through the plan, so an annotation lands at the same
                // coordinate the marks do once the axis is temporal. No
                // yAxisId: this chart draws a single y axis now.
                x={xAxis.toAxisValue(annotation.x)}
                stroke="var(--primary)"
                strokeDasharray="2 2"
                label={annotationLabel(annotation.label, i)}
              />
            ) : (
              <ReferenceArea
                key={`anno-${annotation.id}`}
                x1={xAxis.toAxisValue(annotation.x)}
                x2={xAxis.toAxisValue(annotation.x2)}
                fill="var(--primary)"
                fillOpacity={0.08}
                label={annotationLabel(annotation.label, i)}
              />
            ),
          )}
          {seriesNames.map((name, i) => {
            const seriesType = config.seriesOptions[name]?.type ?? variant
            const color = resolveSeriesColor(name, i, { seriesOptions: config.seriesOptions })
            const curve = curveTypeFor(name, config, 'monotone')
            // A combo chart: Redash lets each series carry its own type, and a
            // series marked as bars used to draw as a line like everything else,
            // so a bar-and-line chart silently lost its bars. 'column' is
            // Redash's spelling, 'bar' this app's; both mean the same mark.
            if (seriesType === 'column' || seriesType === 'bar') {
              return (
                <Bar
                  key={name}
                  dataKey={name}
                  name={config.seriesOptions[name]?.name ?? name}
                  fill={color}
                  stackId={stackId}
                  {...SERIES_ANIMATION}
                >
                  {config.showDataLabels && <LabelList position="top" formatter={formatLabelValue} />}
                </Bar>
              )
            }
            if (seriesType === 'area') {
              return (
                <Area
                  key={name}
                  type={curve}
                  dataKey={name}
                  name={config.seriesOptions[name]?.name ?? name}
                  fill={color}
                  stroke={color}
                  fillOpacity={AREA_FILL_OPACITY}
                  stackId={stackId}
                  activeDot={ACTIVE_DOT}
                  {...LINE_MARK}
                  {...SERIES_ANIMATION}
                >
                  {config.showDataLabels && <LabelList position="top" formatter={formatLabelValue} />}
                </Area>
              )
            }
            return (
              <Line
                key={name}
                type={curve}
                dataKey={name}
                name={config.seriesOptions[name]?.name ?? name}
                stroke={color}
                dot={false}
                activeDot={ACTIVE_DOT}
                {...LINE_MARK}
                {...SERIES_ANIMATION}
              >
                {config.showDataLabels && <LabelList position="top" formatter={formatLabelValue} />}
              </Line>
            )
          })}
          {rightAxisSeriesNames.map((name, i) => {
            const color = resolveSeriesColor(name, seriesNames.length + i, { seriesOptions: config.seriesOptions })
            // These carry a per-series type exactly like the series above, and
            // ignoring it here was the same bug in a second place: a column
            // mapped to yRight drew as a line however it was marked. This chart
            // has drawn a single y axis since the indexed rework, so a bar here
            // shares that axis rather than needing one of its own.
            const seriesType = config.seriesOptions[name]?.type
            const curve = curveTypeFor(name, config, 'monotone')
            if (seriesType === 'column' || seriesType === 'bar') {
              return (
                <Bar
                  key={name}
                  dataKey={name}
                  name={config.seriesOptions[name]?.name ?? name}
                  fill={color}
                  stackId={stackId}
                  {...SERIES_ANIMATION}
                />
              )
            }
            // 'area' used to fall through to the line branch below, and the
            // line marks drew under the raw key with a pinned monotone curve,
            // so a rename, a curve, or an area mark written for a right-axis
            // series was honored by the main map and dropped by this one.
            if (seriesType === 'area') {
              return (
                <Area
                  key={name}
                  type={curve}
                  dataKey={name}
                  name={config.seriesOptions[name]?.name ?? name}
                  fill={color}
                  stroke={color}
                  fillOpacity={AREA_FILL_OPACITY}
                  stackId={stackId}
                  activeDot={ACTIVE_DOT}
                  {...LINE_MARK}
                  {...SERIES_ANIMATION}
                />
              )
            }
            return (
              <Line
                key={name}
                type={curve}
                dataKey={name}
                name={config.seriesOptions[name]?.name ?? name}
                stroke={color}
                dot={false}
                activeDot={ACTIVE_DOT}
                {...LINE_MARK}
                {...SERIES_ANIMATION}
              />
            )
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}
