'use client'

import { Cell, Legend, Pie, PieChart as RechartsPieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { CHART_INITIAL_DIMENSION } from '@/lib/chart-marks'
import { formatCompactNumber } from '@/lib/chart-format'
import type { DisplayPatterns } from '@/lib/date-pattern'
import { resolveSeriesColor } from '@/lib/chart-colors'
import { ChartTooltip } from './chart-tooltip'
import { ChartLegend } from './chart-legend'
import { ChartFrame } from './chart-frame'
import { chartSummary } from './chart-summary'
import { SERIES_ANIMATION } from './animation'
import type { ResolvedChartConfig } from './resolve-config'
import type { QueryResultData } from '@/lib/mock-data'

// Share of the plot box the pie spans. Percentages rather than the old fixed
// 150px radius, which needed a 300px-square plot to fit and so was cropped by
// its own frame in any dashboard widget smaller than that instead of scaling
// down. recharts resolves these against the plot box it is given.
const OUTER_RADIUS_PCT = 80
// With slice labels on, the pie gives up room for them: they draw outside the
// arc, and a label the plot clips is worse than a smaller pie.
const LABELLED_OUTER_RADIUS_PCT = 68
// The donut hole as a share of the pie, carried over from the old fixed pair
// (80px hole in a 150px pie) so the ring keeps its weight at either size.
const DONUT_HOLE_RATIO = 80 / 150

interface PieChartRendererProps {
  config: ResolvedChartConfig
  data: QueryResultData
  /**
   * The display formats from Settings > Formats (see ChartRenderer). A pie has
   * no axis, but its slice names are x-column values, so a date-keyed pie has
   * dates to write and the summary below has to write them the same way.
   */
  patterns: DisplayPatterns
}

export function PieChart({ config, data, patterns }: PieChartRendererProps) {
  const valueCol = config.effectiveYCols[0]

  // A pie's data.rows is one row per slice, holding a single value column
  // (valueCol) plus the slice name in config.xCol, not one column per slice:
  // passing the slice names themselves as the series list would look each one
  // up as `row[sliceName]`, a key that is never on a pie row. valueCol is the
  // one column this chart's Pie actually reads (dataKey below), so it is the
  // only series name the summary needs; config.xCol supplies each slice name.
  const summary = chartSummary(config, data.rows, [valueCol], patterns)

  const outerPct = config.showDataLabels ? LABELLED_OUTER_RADIUS_PCT : OUTER_RADIUS_PCT

  return (
    <ChartFrame
      seriesCount={data.rows.length}
      summary={summary}
    >
      <ResponsiveContainer initialDimension={CHART_INITIAL_DIMENSION}>
        <RechartsPieChart>
          <Pie
            data={data.rows}
            dataKey={valueCol}
            nameKey={config.xCol}
            cx="50%"
            cy="50%"
            innerRadius={config.donut ? `${Math.round(outerPct * DONUT_HOLE_RATIO)}%` : 0}
            outerRadius={`${outerPct}%`}
            label={config.showDataLabels ? ({ value }) => formatCompactNumber(Number(value)) : undefined}
            {...SERIES_ANIMATION}
          >
            {data.rows.map((_, i) => (
              <Cell
                key={i}
                fill={resolveSeriesColor(String(data.rows[i][config.xCol]), i, { seriesOptions: config.seriesOptions })}
              />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip patterns={patterns} />} />
          {data.rows.length >= 2 && <Legend content={<ChartLegend />} />}
        </RechartsPieChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}
