'use client'

import type { ReactNode } from 'react'
import { CHART_FILL_VAR } from '@/lib/chart-marks'

// The plot itself: the area the marks are drawn in, held constant so that
// adding a legend or an axis band grows the card instead of squeezing the
// data. This is a floor, not a cap; the frame is free to be taller. 320 is
// roughly the plot area the old fixed 400px box actually yielded for a
// one-series chart once the 32px padding and the axis band came out, so an
// ordinary chart is no shorter than before and a chart with more chrome
// grows instead of squeezing.
export const PLOT_MIN_HEIGHT = 320
// The x-axis tick labels and their band. Pie has no axis, so it reserves none.
export const AXIS_BAND_HEIGHT = 32
// One row of ChartLegend items: an 8px swatch on a 12px label, plus its gap.
export const LEGEND_ROW_HEIGHT = 24
// How many legend items fit on a row before it wraps. An estimate, and
// deliberately conservative: over-reserving costs a little whitespace, while
// under-reserving clips the band a keyboard user just tabbed to.
export const LEGEND_ITEMS_PER_ROW = 4
// The p-4 on the frame itself, top and bottom.
export const FRAME_PADDING = 32

interface ChartFrameSize {
  seriesCount: number
  hasAxisBand?: boolean
}

// CHART_FILL_VAR is declared in lib/chart-marks.ts, because ChartFrame is not
// its only reader: the five renderers that draw outside this frame honour it
// too. Re-exported here so the existing importers of the frame's contract do
// not have to care that it moved.
export { CHART_FILL_VAR } from '@/lib/chart-marks'

// Height is content plus chrome rather than a fixed 400px. The old fixed box
// gave a bare pie and an eight-series bar chart with rotated date labels the
// same room, so the axis band was squeezed out of the second one and the card
// grew a nested scrollbar. This is the frame's preferred height: ChartFrame
// below also applies max-h-full, so a bounded parent (a dashboard widget
// card) caps the frame at its own height instead of forcing a nested
// scrollbar, and only an unbounded parent lets this computed value stand.
export function chartFrameHeight({ seriesCount, hasAxisBand = false }: ChartFrameSize): number {
  const legendRows = seriesCount >= 2 ? Math.ceil(seriesCount / LEGEND_ITEMS_PER_ROW) : 0
  return (
    PLOT_MIN_HEIGHT +
    (hasAxisBand ? AXIS_BAND_HEIGHT : 0) +
    legendRows * LEGEND_ROW_HEIGHT +
    FRAME_PADDING
  )
}

interface ChartFrameProps extends ChartFrameSize {
  children: ReactNode
  // The plot's accessible name. Read by chartSummary (chart-summary.ts)
  // from the same config, chartData, and seriesNames the caller already has.
  // With the frame holding nothing but the plot, role="img" could sit on the
  // frame itself; it stays on the inner wrapper so that adding any control
  // back to this frame cannot silently hide it from assistive technology,
  // which is what descendants of role="img" are.
  summary?: string
}

export function ChartFrame({ seriesCount, hasAxisBand, summary, children }: ChartFrameProps) {
  const plotProps = summary ? { role: 'img' as const, 'aria-label': summary } : {}

  return (
    <div
      data-testid="chart-frame"
      // The inline height is a preferred height, not a hard one: max-h-full
      // (max-height: 100%) resolves against the parent's own height only when
      // that parent has a definite height (a bounded dashboard widget card),
      // in which case it caps the frame there and the widget's overflow-auto
      // body never gets a nested scrollbar. In an unbounded parent (no
      // ancestor gives this box a definite height) the percentage resolves to
      // none, so it is inert there and the computed height above still
      // applies in full.
      className="flex max-h-full flex-col gap-2 p-4"
      // The computed height is the FALLBACK, not the value. An ancestor that
      // set CHART_FILL_VAR to 100% wins, and because both live in the same
      // inline declaration there is no specificity fight with a class: a
      // `h-full` utility could never have beaten an inline `height` anyway.
      // max-h-full still caps, so a bounded parent SHORTER than the computed
      // height behaves exactly as before whether it opted in or not.
      style={{
        height: `var(${CHART_FILL_VAR}, ${chartFrameHeight({ seriesCount, hasAxisBand })}px)`,
      }}
    >
      {/* The plot wrapper: a definite-height flex child (min-h-0 keeps it from
          growing past the frame) so ResponsiveContainer's 100% height resolves
          against a real number instead of an auto height that never shrinks. */}
      <div {...plotProps} className="min-h-0 flex-1">
        {children}
      </div>
    </div>
  )
}
