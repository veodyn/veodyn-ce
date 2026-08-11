'use client'

import { useMemo } from 'react'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import type { RedashBoxPlotOptions } from '@/services/redash/types'
import { formatCompactNumber } from '@/lib/chart-format'
import { resolveSeriesColor } from '@/lib/chart-colors'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  boxSummaryRows,
  buildBoxPlotModel,
  describeBox,
  describeOutliers,
  resolveBoxPlotColumns,
  EMPTY_BOX_PLOT_MODEL,
  type BoxStats,
} from './box-plot-model'

interface BoxPlotRendererProps {
  visualization: MockVisualization
  data: QueryResultData
}

const CHART_HEIGHT = 340
// Width of the y-axis gutter, in px. Three places have to agree on it: the
// padding that reserves it, the left edge of the plot frame, and the tick
// label that sits in it. As a number rather than three matched Tailwind
// classes, because Tailwind needs literal class names, so a class version
// could not be one constant at all.
const AXIS_GUTTER = 56

function BoxColumn({ box, color, pct }: { box: BoxStats; color: string; pct: (value: number) => number }) {
  const outliers = describeOutliers(box)
  return (
    <Tooltip>
      {/* The whole column is the hover and focus target, and it carries the
          accessible name: the marks inside are bare divs a screen reader has
          nothing to say about, and the median line is two pixels tall, which
          is not a pointer target. role="img" is what lets aria-label name a
          graphic at all (a plain div is generic, where aria-label is ignored),
          and it hides the decorative marks from the accessibility tree. */}
      <TooltipTrigger
        render={
          <div
            role="img"
            aria-label={describeBox(box)}
            tabIndex={0}
            className="relative flex flex-col items-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{ height: CHART_HEIGHT }}
          />
        }
      >
        {/* whiskers */}
        <div
          className="absolute w-px bg-muted-foreground"
          style={{ bottom: `${pct(box.min)}%`, height: `${pct(box.max) - pct(box.min)}%` }}
        />
        <div className="absolute h-px w-3 bg-muted-foreground" style={{ bottom: `${pct(box.min)}%` }} />
        <div className="absolute h-px w-3 bg-muted-foreground" style={{ bottom: `${pct(box.max)}%` }} />
        {/* box (Q1-Q3) */}
        <div
          className="absolute w-3/4 rounded-sm border"
          style={{
            bottom: `${pct(box.q1)}%`,
            height: `${Math.max(pct(box.q3) - pct(box.q1), 0.5)}%`,
            backgroundColor: color,
            opacity: 0.35,
            borderColor: color,
          }}
        />
        {/* median */}
        <div className="absolute h-0.5 w-3/4" style={{ bottom: `${pct(box.median)}%`, backgroundColor: color }} />
        {/* outliers */}
        {box.outliers.map((value, oi) => (
          <div
            key={oi}
            className="absolute h-1.5 w-1.5 rounded-full border"
            style={{ bottom: `${pct(value)}%`, borderColor: color, backgroundColor: 'var(--card)' }}
          />
        ))}
      </TooltipTrigger>
      <TooltipContent>
        <div className="flex flex-col gap-0.5 tabular-nums">
          <div className="font-medium">{box.category}</div>
          {boxSummaryRows(box).map((row) => (
            <div key={row.label} className="flex justify-between gap-4">
              <span>{row.label}</span>
              <span>{row.value}</span>
            </div>
          ))}
          {outliers && <div>{outliers}</div>}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

export function BoxPlotRenderer({ visualization, data }: BoxPlotRendererProps) {
  const options = (visualization.options ?? {}) as RedashBoxPlotOptions
  const { categoryCol, valueCol } = resolveBoxPlotColumns(options, data)

  const model = useMemo(
    () => (categoryCol && valueCol ? buildBoxPlotModel(data, categoryCol, valueCol) : EMPTY_BOX_PLOT_MODEL),
    [data, categoryCol, valueCol]
  )

  if (model.boxes.length === 0) {
    return <div className="p-4 text-sm text-muted-foreground">Box plot requires a category and a numeric value column.</div>
  }

  const range = model.domainMax - model.domainMin || 1
  const pct = (value: number) => ((value - model.domainMin) / range) * 100

  return (
    <div className="p-4">
      <div className="relative" style={{ paddingLeft: AXIS_GUTTER }}>
        {/* Tick layer, behind the columns: each tick is ONE element carrying
            both its label and its gridline, so the two cannot be positioned
            independently. It spans the gutter as well as the plot, which is
            why the gutter is padding on this box rather than a sibling. */}
        <div className="pointer-events-none absolute inset-x-0 top-0" style={{ height: CHART_HEIGHT }}>
          <div className="absolute inset-y-0 right-0 border-b border-l border-border" style={{ left: AXIS_GUTTER }} />
          {model.ticks.map((tick) => (
            <div
              key={tick}
              className="absolute inset-x-0 flex translate-y-1/2 items-center"
              style={{ bottom: `${pct(tick)}%` }}
            >
              <div
                className="shrink-0 pr-2 text-right text-xs text-muted-foreground"
                style={{ width: AXIS_GUTTER }}
              >
                {formatCompactNumber(tick)}
              </div>
              <div className="flex-1 border-t border-border/50" />
            </div>
          ))}
        </div>
        {/* ONE row of cells, not a row of boxes over a separate row of labels.
            A category's marks and its label are the same grid cell, so the gap
            between columns applies to both at once and a label cannot drift off
            the box it names, whatever a later edit does to the spacing. */}
        <div
          className="relative grid gap-4"
          style={{ gridTemplateColumns: `repeat(${model.boxes.length}, minmax(3rem, 1fr))` }}
        >
          {model.boxes.map((box, i) => (
            <div key={box.category} className="flex min-w-0 flex-col">
              <BoxColumn box={box} color={resolveSeriesColor(box.category, i)} pct={pct} />
              <div className="truncate pt-1 text-center text-xs text-muted-foreground">{box.category}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
