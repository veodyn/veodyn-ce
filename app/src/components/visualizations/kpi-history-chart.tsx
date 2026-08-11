'use client'

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { AXIS_LINE, AXIS_TICK, GRID } from './chart/axis-config'
import { SERIES_ANIMATION } from './chart/animation'
import { resolveSeriesColor } from '@/lib/chart-colors'
import { formatCompactNumber } from '@/lib/chart-format'
import { ACTIVE_DOT, CHART_INITIAL_DIMENSION, LINE_MARK } from '@/lib/chart-marks'
import type { DisplayPatterns } from '@/lib/date-pattern'
import { useFormats } from '@/hooks/use-formats'
import { cn } from '@/lib/utils'
import type { MetricTarget, MetricThresholds } from '@/types/metric'
import {
  BAND_OPACITY,
  STATUS_FILL,
  historyScale,
  statusBands,
} from './kpi-history-scale'
import { formatMetricValue } from '@/lib/metric-value-format'
import { historySummary, readingTime, type HistoryReading } from './kpi-history-summary'

// Was KpiSparkline, in a 64px box, and it kept the two decisions that made it
// one after it moved into a 224px card: hidden axes and a self-relative domain.
// Both are right for an inline trend mark and wrong for the page's main chart.
// A sparkline says "which way"; this has to say "how far from target, and for
// how long".
//
// It lives under visualizations/ rather than under kpi/ because it is no longer
// only the KPI page's chart: KpiHistoryRenderer draws a registered KPI_HISTORY
// visualization with it, so it renders on dashboards, public reports and
// embeds. Both source guards that protect a drawing surface (animation.test.ts
// and viz-chrome-tokens.test.ts) only walk this directory, and a chart that can
// end up on a dashboard belongs under them. It stays presentational: typed
// props in, no registry and no options bag.

const SERIES_COLOR = resolveSeriesColor('kpi', 0)

// Reference-line labels sit inside the plot, right-aligned, so they do not need
// axis gutter of their own. One size below the ticks, matching the convention
// in axis-config.ts for commentary layered over a chart.
const REFERENCE_LABEL_FONT_SIZE = 11

interface KpiHistoryChartProps {
  history: HistoryReading[]
  /** The KPI's unit, so a reading reads "27 snapshots/hr" rather than "27". */
  unit?: string | null
  // Optional so the chart still renders for a caller that has readings and no
  // KPI to hand (the loading and preview paths). Without them it degrades to
  // the old self-relative scale, which is honest when there is no target to be
  // far from, and the axes stay: those were never the sparkline's to hide.
  target?: MetricTarget
  thresholds?: MetricThresholds
  className?: string
}

/**
 * Exactly what recharts renders on hover: `active`, plus the payload entry
 * whose own `payload` is the data point under the pointer. Exported so a test
 * can render it directly, since jsdom does no layout and recharts can never
 * resolve a hover to a point there.
 */
export function HistoryTooltip({
  active,
  payload,
  patterns,
  unit,
}: {
  active?: boolean
  payload?: { payload: HistoryReading }[]
  // Passed in rather than read from the hook here, so the same formats reach
  // this panel and the summary above it from one place.
  patterns: DisplayPatterns
  unit?: string | null
}) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null
  return (
    <div className="rounded-md border bg-popover px-2 py-1 text-xs shadow-md">
      <div className="font-medium tabular-nums text-popover-foreground">
        {formatMetricValue(point.value, unit)}
      </div>
      <div className="text-muted-foreground">{readingTime(point.at, patterns)}</div>
    </div>
  )
}

export function KpiHistoryChart({
  history,
  unit,
  target,
  thresholds,
  className,
}: KpiHistoryChartProps) {
  // The one read of Settings > Formats on this chart. Every surface that writes
  // a timestamp (the accessible summary, the hover panel, the x axis) takes it
  // from here.
  const patterns = useFormats()

  if (history.length === 0) {
    // A blank box reads as a broken chart. Say why it is empty: a KPI has no
    // history until its first evaluation lands.
    return (
      <p className={cn('py-4 text-center text-sm text-muted-foreground', className)}>
        No readings yet. History appears after the first evaluation.
      </p>
    )
  }

  const scale =
    target && thresholds
      ? historyScale(
          history.map((point) => point.value),
          target,
          thresholds
        )
      : undefined
  const bands = scale && target && thresholds ? statusBands(scale.domain, target, thresholds) : []

  return (
    <div
      data-testid="kpi-history-chart"
      role="img"
      aria-label={historySummary(history, patterns, unit, target)}
      className={cn('h-full w-full', className)}
    >
      <ResponsiveContainer width="100%" height="100%" initialDimension={CHART_INITIAL_DIMENSION}>
        <LineChart data={history} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid {...GRID} />
          {/* The bands go in before the grid lines matter and before the
              series, so the line is never drawn underneath a fill. */}
          {bands.map((band) => (
            <ReferenceArea
              key={band.status}
              y1={band.from}
              y2={band.to}
              fill={STATUS_FILL[band.status]}
              fillOpacity={BAND_OPACITY}
              // Without this recharts strokes the area's edge, which reads as a
              // fourth threshold rule sitting on top of the two real ones.
              stroke="none"
              ifOverflow="hidden"
            />
          ))}
          <XAxis
            dataKey="at"
            {...AXIS_LINE}
            tick={AXIS_TICK}
            minTickGap={48}
            tickFormatter={(at: string) => readingTime(at, patterns)}
          />
          <YAxis
            {...AXIS_LINE}
            tick={AXIS_TICK}
            width={52}
            // dataMin/dataMax only when there is nothing to compare against.
            // With a target, the domain has to contain it or the chart cannot
            // draw the distance the reader came for.
            domain={scale?.domain ?? ['dataMin', 'dataMax']}
            ticks={scale?.ticks}
            tickFormatter={formatCompactNumber}
          />
          {/* recharts matches on the x axis, so the nearest reading wins
              anywhere in its vertical band. On a 2px line, requiring the
              pointer to land on the stroke itself would make the tooltip
              almost unreachable. */}
          <Tooltip
            content={<HistoryTooltip unit={unit} patterns={patterns} />}
            cursor={{ stroke: SERIES_COLOR, strokeOpacity: 0.3, strokeWidth: 1 }}
            isAnimationActive={false}
            allowEscapeViewBox={{ y: true }}
            wrapperStyle={{ outline: 'none', zIndex: 10 }}
          />
          {/* Only when it is a DIFFERENT rule from the target. A KPI whose
              at-risk threshold equals its target (On-Time Performance: both
              85%) drew two dashed lines at the same y with two labels
              overprinted at the same corner, which rendered as a smear of
              letters. One line, one label, and nothing is lost: the target line
              below already marks that value. */}
          {thresholds && thresholds.atRisk !== target?.value && (
            <ReferenceLine
              y={thresholds.atRisk}
              stroke={STATUS_FILL['at-risk']}
              strokeDasharray="4 4"
              label={{
                // Carries its value, like the target line below. A bare "At
                // risk" also collided with the status badge on the same page,
                // so the reader met the same two words meaning two different
                // things: the KPI's current verdict, and where the rule sits.
                value: `At risk ${formatMetricValue(thresholds.atRisk, unit)}`,
                position: 'insideTopRight',
                fontSize: REFERENCE_LABEL_FONT_SIZE,
                fill: 'var(--muted-foreground)',
              }}
            />
          )}
          {target && (
            <ReferenceLine
              y={target.value}
              stroke="var(--muted-foreground)"
              strokeDasharray="4 4"
              label={{
                value: `Target ${formatMetricValue(target.value, unit)}`,
                position: 'insideTopRight',
                fontSize: REFERENCE_LABEL_FONT_SIZE,
                fill: 'var(--muted-foreground)',
              }}
            />
          )}
          <Line
            type="monotone"
            dataKey="value"
            stroke={SERIES_COLOR}
            dot={false}
            // Which reading is being read, marked on the line. Without this the
            // tooltip names a value with nothing on the chart pointing at it.
            activeDot={ACTIVE_DOT}
            {...LINE_MARK}
            {...SERIES_ANIMATION}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
