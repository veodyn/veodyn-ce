import { lazy, type ComponentType } from 'react'
import type { VisualizationEditorProps } from '@/lib/visualizations'

export const BoxPlotEditor = lazy(() =>
  import('@/components/visualizations/editors/box-plot-editor').then((m) => ({ default: m.BoxPlotEditor }))
)
export const ChartEditor = lazy(() =>
  import('@/components/visualizations/editors/chart-editor').then((m) => ({ default: m.ChartEditor }))
)
export const ChoroplethEditor = lazy(() =>
  import('@/components/visualizations/editors/choropleth-editor').then((m) => ({ default: m.ChoroplethEditor }))
)
export const CohortEditor = lazy(() =>
  import('@/components/visualizations/editors/cohort-editor').then((m) => ({ default: m.CohortEditor }))
)
export const CounterEditor = lazy(() =>
  import('@/components/visualizations/editors/counter-editor').then((m) => ({ default: m.CounterEditor }))
)
export const DetailsEditor = lazy(() =>
  import('@/components/visualizations/editors/details-editor').then((m) => ({ default: m.DetailsEditor }))
)
export const FunnelEditor = lazy(() =>
  import('@/components/visualizations/editors/funnel-editor').then((m) => ({ default: m.FunnelEditor }))
)
export const HeatmapEditor = lazy(() =>
  import('@/components/visualizations/editors/heatmap-editor').then((m) => ({ default: m.HeatmapEditor }))
)
export const KpiHistoryEditor = lazy(() =>
  import('@/components/visualizations/editors/kpi-history-editor').then((m) => ({ default: m.KpiHistoryEditor }))
)
export const MapEditor = lazy(() =>
  import('@/components/visualizations/editors/map-editor').then((m) => ({ default: m.MapEditor }))
)
export const PivotEditor = lazy(() =>
  import('@/components/visualizations/editors/pivot-editor').then((m) => ({ default: m.PivotEditor }))
)
export const SankeyEditor = lazy(() =>
  import('@/components/visualizations/editors/sankey-editor').then((m) => ({ default: m.SankeyEditor }))
)
export const SunburstEditor = lazy(() =>
  import('@/components/visualizations/editors/sunburst-editor').then((m) => ({ default: m.SunburstEditor }))
)
export const TableEditor = lazy(() =>
  import('@/components/visualizations/editors/table-editor').then((m) => ({ default: m.TableEditor }))
)
export const WordCloudEditor = lazy(() =>
  import('@/components/visualizations/editors/word-cloud-editor').then((m) => ({ default: m.WordCloudEditor }))
)

export const CORE_EDITORS: Readonly<Record<string, ComponentType<VisualizationEditorProps>>> = {
  BOXPLOT: BoxPlotEditor,
  CHART: ChartEditor,
  CHOROPLETH: ChoroplethEditor,
  COHORT: CohortEditor,
  COUNTER: CounterEditor,
  DETAILS: DetailsEditor,
  FUNNEL: FunnelEditor,
  HEATMAP: HeatmapEditor,
  KPI_HISTORY: KpiHistoryEditor,
  MAP: MapEditor,
  PIVOT: PivotEditor,
  SANKEY: SankeyEditor,
  SUNBURST_SEQUENCE: SunburstEditor,
  TABLE: TableEditor,
  WORD_CLOUD: WordCloudEditor,
}
