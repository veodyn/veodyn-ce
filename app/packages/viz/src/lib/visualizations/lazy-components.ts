// The drawing and configuring halves of every core visualization, loaded on
// demand. ./core registers plugins as an import side effect and is reached from
// providers.tsx on every route, so importing the components directly pulled
// maplibre-gl, recharts and d3 into every entry graph: measured 2026-08-02, the
// sign-in page downloaded 1,601 KB of JS, 792 KB of it maplibre + recharts.
//
// `Renderer` and `Editor` SUSPEND on first render of each type, so every call
// site needs a Suspense boundary. The two that exist own one:
// components/visualizations/visualization-renderer.tsx and
// components/visualizations/edit-visualization-dialog.tsx.
//
// `.then(m => ({ default: m.X }))` adapts these named exports for React.lazy.
// Written out per component so the bundler sees a static import specifier; a
// helper taking the module path as a parameter would not split.
import { lazy } from 'react'

// ── Renderers ──────────────────────────────────────────────────────────────

export const BoxPlotRenderer = lazy(() =>
  import('../../components/visualizations/box-plot-renderer').then((m) => ({ default: m.BoxPlotRenderer }))
)
export const ChartRenderer = lazy(() =>
  import('../../components/visualizations/chart').then((m) => ({ default: m.ChartRenderer }))
)
export const ChoroplethRenderer = lazy(() =>
  import('../../components/visualizations/choropleth-renderer').then((m) => ({ default: m.ChoroplethRenderer }))
)
export const CohortRenderer = lazy(() =>
  import('../../components/visualizations/cohort-renderer').then((m) => ({ default: m.CohortRenderer }))
)
export const CounterRenderer = lazy(() =>
  import('../../components/visualizations/counter-renderer').then((m) => ({ default: m.CounterRenderer }))
)
export const DetailsRenderer = lazy(() =>
  import('../../components/visualizations/details-renderer').then((m) => ({ default: m.DetailsRenderer }))
)
export const FunnelRenderer = lazy(() =>
  import('../../components/visualizations/funnel-renderer').then((m) => ({ default: m.FunnelRenderer }))
)
export const HeatmapRenderer = lazy(() =>
  import('../../components/visualizations/heatmap-renderer').then((m) => ({ default: m.HeatmapRenderer }))
)
export const KpiHistoryRenderer = lazy(() =>
  import('../../components/visualizations/kpi-history-renderer').then((m) => ({ default: m.KpiHistoryRenderer }))
)
export const MapRenderer = lazy(() =>
  import('../../components/visualizations/map-renderer').then((m) => ({ default: m.MapRenderer }))
)
export const PivotRenderer = lazy(() =>
  import('../../components/visualizations/pivot-renderer').then((m) => ({ default: m.PivotRenderer }))
)
export const SankeyRenderer = lazy(() =>
  import('../../components/visualizations/sankey-renderer').then((m) => ({ default: m.SankeyRenderer }))
)
export const SunburstRenderer = lazy(() =>
  import('../../components/visualizations/sunburst-renderer').then((m) => ({ default: m.SunburstRenderer }))
)
export const TableRenderer = lazy(() =>
  import('../../components/visualizations/table-renderer').then((m) => ({ default: m.TableRenderer }))
)
export const WordCloudRenderer = lazy(() =>
  import('../../components/visualizations/word-cloud-renderer').then((m) => ({ default: m.WordCloudRenderer }))
)
