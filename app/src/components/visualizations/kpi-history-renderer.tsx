'use client'

// The registered KPI_HISTORY renderer: the adapter between a stored
// visualization and the presentational chart beside it.
//
// The recovery this adapter used to hold (readings, target, thresholds) now
// lives in ./kpi-history-model, because the plugin's `validate` calls it on
// every route while this module reaches recharts. Keeping that recovery out of
// here is what lets the KPI page go on passing real KpiHistoryPoint values,
// checked by the compiler, instead of building a fake visualization to talk to
// its own chart, without also putting a charting library on the sign-in page.
import { useMemo } from 'react'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import { FILLABLE_PANEL_HEIGHT } from '@/lib/chart-marks'
import type { RedashKpiHistoryOptions } from '@/services/redash/types'
import { KpiHistoryChart } from './kpi-history-chart'
import {
  kpiHistoryReadings,
  kpiHistoryTarget,
  kpiHistoryThresholds,
} from './kpi-history-model'

// Declared here rather than imported from '@/lib/visualizations': the barrel
// imports ./core, which imports the plugin that imports this module, so taking
// the shared type would close a cycle. Every core renderer states its own props
// for the same reason.
interface KpiHistoryRendererProps {
  visualization: MockVisualization
  data: QueryResultData
}

export function KpiHistoryRenderer({ visualization, data }: KpiHistoryRendererProps) {
  // Memoized rather than cast inline: `?? {}` mints a fresh object on every
  // render for a visualization with no options, which would make the readings
  // below recompute every time the widget re-rendered.
  const stored = visualization.options
  const options = useMemo(() => (stored ?? {}) as RedashKpiHistoryOptions, [stored])
  const readings = useMemo(() => kpiHistoryReadings(options, data), [options, data])

  if (readings.length === 0) {
    // Distinct from the chart's own "No readings yet", which is the KPI page's
    // answer: there, a KPI genuinely has no history until its first evaluation.
    // Here the query returned something and none of it could be plotted, and
    // saying so names the fix.
    return (
      <div className="p-4 text-sm text-muted-foreground">
        No readings to draw. This visualization needs a timestamp column and a numeric value
        column.
      </div>
    )
  }

  return (
    <div className="p-4" style={{ height: FILLABLE_PANEL_HEIGHT }}>
      <KpiHistoryChart
        history={readings}
        unit={options.unit}
        target={kpiHistoryTarget(options)}
        thresholds={kpiHistoryThresholds(options)}
      />
    </div>
  )
}
