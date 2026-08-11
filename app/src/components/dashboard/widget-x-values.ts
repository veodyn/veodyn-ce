import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import { resolveChartConfig } from '@/components/visualizations/chart/resolve-config'

// The chart's x-axis is a categorical scale keyed by whatever the x column's
// values render as (see annotationsForWidget), so placing an annotation needs
// the actual x values out of the widget's own query result, not just the
// resolved column name. xIsDatetime comes along too: annotations only make
// sense on a real datetime x-axis (per spec), and a naive date-string parse
// of a non-datetime axis (e.g. plain year categories like "2025") would
// otherwise happily "snap" and place a marker on the wrong kind of chart.
export function widgetXValues(
  visualization: MockVisualization,
  data: QueryResultData
): { xValues: unknown[]; xIsDatetime: boolean } {
  const { xCol, xIsDatetime } = resolveChartConfig(visualization, data)
  return { xValues: data.rows.map((row) => row[xCol]), xIsDatetime }
}
