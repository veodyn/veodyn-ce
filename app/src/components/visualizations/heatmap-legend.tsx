'use client'

import { getSequentialScale } from '@/lib/chart-colors'
import { formatCompactNumber } from '@/lib/chart-format'

interface HeatmapLegendProps {
  min: number
  max: number
  valueLabel: string
  // True when the colour domain (min/max above) is the 2nd/98th percentile
  // of the cell values rather than the true min/max. A clipped scale that
  // does not say so is a chart lying about its own range: values beyond the
  // ends still render in the grid, clamped to the endpoint colour, so the
  // legend has to say the ends are not the true extremes.
  clipped: boolean
}

// Sampling resolution for the gradient bar. The bar is built from the same
// color-mix ramp the cells paint (getSequentialScale), sampled at this many
// evenly spaced points across the domain, rather than a hand-written CSS
// gradient string: a hand-written gradient can drift from the cells it
// describes the moment the ramp formula changes, this cannot.
const GRADIENT_SAMPLES = 10

export function HeatmapLegend({ min, max, valueLabel, clipped }: HeatmapLegendProps) {
  const colorFor = getSequentialScale(min, max)
  const stops = Array.from({ length: GRADIENT_SAMPLES + 1 }, (_, i) =>
    colorFor(min + ((max - min) * i) / GRADIENT_SAMPLES)
  )

  return (
    // pt-3 as well as pb-3: with padding on the bottom only the bar sat
    // directly against the last row of cells, reading as part of the grid
    // rather than as the key to it.
    <div className="flex items-center gap-2 px-4 pt-3 pb-3 text-xs text-muted-foreground">
      <span className="truncate" title={valueLabel}>
        {valueLabel}
      </span>
      <span className="tabular-nums">{formatCompactNumber(min)}</span>
      <div
        aria-hidden="true"
        data-testid="heatmap-legend-gradient"
        className="h-2 flex-1 rounded-full"
        style={{ backgroundImage: `linear-gradient(to right, ${stops.join(', ')})` }}
      />
      <span className="tabular-nums">{formatCompactNumber(max)}</span>
      {clipped && (
        <span
          className="shrink-0 text-muted-foreground/80"
          title="Colour scale clipped to the 2nd-98th percentile. Values beyond the ends still render, clamped to the endpoint colour."
        >
          (clipped)
        </span>
      )}
    </div>
  )
}
