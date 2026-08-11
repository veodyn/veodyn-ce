'use client'

import { parseDateValue } from '@/lib/chart-format'
import type { DisplayPatterns } from '@/lib/date-pattern'
import {
  contextFor,
  formatDateContext,
  formatDateTick,
  granularityForStep,
  niceTimeTicks,
  smallestGap,
  startsContextPeriod,
  type TimeGranularity,
} from '@/lib/chart-time-axis'
// Type sizes come from axis-config rather than being written out here, so this
// axis matches the other four renderers and the chrome guard has one place to
// check. Same pixels either way: AXIS_TICK.fontSize is 12 and
// ANNOTATION_LABEL_FONT_SIZE is 11, which is what these were.
import { ANNOTATION_LABEL_FONT_SIZE, AXIS_TICK } from './axis-config'
import type { ResolvedChartConfig } from './resolve-config'

// The numeric mirror of the x column, added per row so recharts can run a real
// time scale over it. The original column stays untouched: tooltips,
// annotations, and the table view still read the value the query returned.
export const X_TIME_KEY = '__xTime'

// Roughly how many ticks to aim for before recharts thins them by minTickGap.
const TARGET_TICKS = 8

// Enough room for the tick label plus the context line under it.
const TWO_LINE_AXIS_HEIGHT = 44

export interface XAxisPlan {
  // Rows to hand the chart: the input rows, plus X_TIME_KEY when the axis is
  // temporal. The same array reference when nothing was added.
  data: Record<string, unknown>[]
  // Spread onto <XAxis>.
  props: Record<string, unknown>
  // Maps a raw x value (an annotation's snapped timestamp, a reference line's
  // configured x) into whatever coordinate space the axis ended up in.
  toAxisValue: (value: unknown) => string | number | undefined
}

function passThrough(value: unknown): string | number | undefined {
  if (value == null) return undefined
  return typeof value === 'number' ? value : String(value)
}

/**
 * Axis props for the x column, and the rows to draw against them.
 *
 * A date column gets a real time scale: ticks land on round boundaries and the
 * distance between two points reflects the time between them, so a gap in the
 * data reads as a gap. A category axis gives every row equal width instead,
 * which is why a query returning one constant timestamp per row used to draw a
 * full-width line under a row of identical labels.
 *
 * `categorical` opts out for bar charts, where bars need discrete bands to size
 * themselves against; those still get span-aware tick labels.
 */
export function planXAxis(
  config: ResolvedChartConfig,
  rows: Record<string, unknown>[],
  patterns: DisplayPatterns,
  { categorical = false }: { categorical?: boolean } = {},
): XAxisPlan {
  const base = {
    dataKey: config.xCol,
    tick: { fontSize: AXIS_TICK.fontSize },
    stroke: 'var(--muted-foreground)',
    minTickGap: 24,
    interval: 'preserveStartEnd' as const,
  }

  const epochs = config.xIsDatetime ? rows.map((row) => parseDateValue(row[config.xCol])) : []
  // One unparseable cell and a numeric axis would drop that row silently, so
  // fall back to the category axis for the whole column instead.
  if (epochs.length === 0 || epochs.some((epoch) => epoch == null)) {
    return { data: rows, props: base, toAxisValue: passThrough }
  }

  const values = epochs as number[]
  let min = values[0]
  let max = values[0]
  for (const value of values) {
    if (value < min) min = value
    if (value > max) max = value
  }

  const ticks = niceTimeTicks(min, max, TARGET_TICKS, smallestGap(values))
  const step = ticks.length > 1 ? ticks[1] - ticks[0] : Math.max(max - min, 1)
  const granularity = granularityForStep(step)

  if (categorical) {
    return {
      data: rows,
      props: {
        ...base,
        tickFormatter: (value: unknown) => formatCategoryTick(value, granularity, patterns),
      },
      toAxisValue: passThrough,
    }
  }

  return {
    data: rows.map((row, i) => ({ ...row, [X_TIME_KEY]: values[i] })),
    props: {
      ...base,
      dataKey: X_TIME_KEY,
      type: 'number' as const,
      scale: 'time' as const,
      domain: ['dataMin', 'dataMax'],
      ticks,
      minTickGap: 40,
      height: contextFor(granularity) == null ? undefined : TWO_LINE_AXIS_HEIGHT,
      tick: <TimeAxisTick granularity={granularity} ticks={ticks} patterns={patterns} />,
      // TimeAxisTick renders its own text, but recharts measures a tick's
      // width by running tickFormatter over the raw value (getTicks.js) to
      // decide what fits in minTickGap. Without this it measures a 13-digit
      // epoch, "1773792000000", and drops most of a perfectly legible axis.
      // Same formatter as the tick element, so what recharts measures is what
      // the axis draws: a 12-hour format is three characters wider than the
      // 24-hour one, and measuring the wrong one packs the labels too tightly.
      tickFormatter: (value: unknown) => formatCategoryTick(value, granularity, patterns),
    },
    toAxisValue: (value) => parseDateValue(value) ?? undefined,
  }
}

function formatCategoryTick(
  value: unknown,
  granularity: TimeGranularity,
  patterns: DisplayPatterns,
): string {
  const ts = parseDateValue(value)
  return ts == null ? String(value) : formatDateTick(ts, granularity, patterns)
}

interface TimeAxisTickProps {
  granularity: TimeGranularity
  // The configured date and time formats, threaded down from the renderer
  // rather than read from a hook here: recharts clones this element per tick,
  // and the axis plan's own tickFormatter (above) needs the same patterns from
  // outside React, so one source keeps the drawn label and the measured one
  // from disagreeing.
  patterns: DisplayPatterns
  // The planned ticks, so the first one can tell whether its own context line
  // is about to be superseded by the next tick's.
  ticks?: number[]
  // Supplied by recharts when it clones this element for each tick.
  x?: number
  y?: number
  index?: number
  payload?: { value?: number }
}

/**
 * A tick label plus, on a second line, the coarser unit it leaves ambiguous.
 *
 * The context line is drawn only where it changes (the first tick, then each
 * midnight or new year), so an intraday axis reads as a row of times with the
 * date stated once, rather than the same date printed under every tick and
 * colliding with its neighbours.
 *
 * The first tick is the exception to that, and had to be taught one of its
 * own. It states the date because it usually does not sit on a boundary, but
 * when the very next tick does, the two labels land one tick gap apart and a
 * ten-character date is wider than that: they overprinted into
 * "2026-07-2026-07-25" on any window opening in the evening. The first tick's
 * date is superseded before a single label's width has passed, so in that one
 * case it says nothing the next tick is not about to say better.
 */
export function TimeAxisTick({ granularity, patterns, ticks, x = 0, y = 0, index = 0, payload }: TimeAxisTickProps) {
  const value = payload?.value
  if (typeof value !== 'number') return null

  const context = contextFor(granularity)
  const startsPeriod = context != null && startsContextPeriod(value, context)
  const nextStartsPeriod =
    context != null && ticks != null && ticks[1] != null && startsContextPeriod(ticks[1], context)
  const showsContext = context != null && (startsPeriod || (index === 0 && !nextStartsPeriod))

  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0}
        y={0}
        dy={12}
        textAnchor="middle"
        fontSize={AXIS_TICK.fontSize}
        fill="var(--muted-foreground)"
      >
        {formatDateTick(value, granularity, patterns)}
      </text>
      {context != null && showsContext && (
        <text
          x={0}
          y={0}
          dy={27}
          // The leftmost tick sits on the plot's left edge, where a centred
          // second line would hang out over the y-axis labels.
          textAnchor={index === 0 ? 'start' : 'middle'}
          fontSize={ANNOTATION_LABEL_FONT_SIZE}
          fill="var(--muted-foreground)"
          opacity={0.75}
        >
          {formatDateContext(value, context, patterns)}
        </text>
      )}
    </g>
  )
}
