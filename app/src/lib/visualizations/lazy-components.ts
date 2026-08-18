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
  import('@/components/visualizations/box-plot-renderer').then((m) => ({ default: m.BoxPlotRenderer }))
)
export const ChartRenderer = lazy(() =>
  import('@/components/visualizations/chart').then((m) => ({ default: m.ChartRenderer }))
)
export const ChoroplethRenderer = lazy(() =>
  import('@/components/visualizations/choropleth-renderer').then((m) => ({ default: m.ChoroplethRenderer }))
)
export const CohortRenderer = lazy(() =>
  import('@/components/visualizations/cohort-renderer').then((m) => ({ default: m.CohortRenderer }))
)
export const CounterRenderer = lazy(() =>
  import('@/components/visualizations/counter-renderer').then((m) => ({ default: m.CounterRenderer }))
)
export const DetailsRenderer = lazy(() =>
  import('@/components/visualizations/details-renderer').then((m) => ({ default: m.DetailsRenderer }))
)
export const FunnelRenderer = lazy(() =>
  import('@/components/visualizations/funnel-renderer').then((m) => ({ default: m.FunnelRenderer }))
)
export const HeatmapRenderer = lazy(() =>
  import('@/components/visualizations/heatmap-renderer').then((m) => ({ default: m.HeatmapRenderer }))
)
export const KpiHistoryRenderer = lazy(() =>
  import('@/components/visualizations/kpi-history-renderer').then((m) => ({ default: m.KpiHistoryRenderer }))
)
export const MapRenderer = lazy(() =>
  import('@/components/visualizations/map-renderer').then((m) => ({ default: m.MapRenderer }))
)
export const PivotRenderer = lazy(() =>
  import('@/components/visualizations/pivot-renderer').then((m) => ({ default: m.PivotRenderer }))
)
export const SankeyRenderer = lazy(() =>
  import('@/components/visualizations/sankey-renderer').then((m) => ({ default: m.SankeyRenderer }))
)
export const SunburstRenderer = lazy(() =>
  import('@/components/visualizations/sunburst-renderer').then((m) => ({ default: m.SunburstRenderer }))
)
export const TableRenderer = lazy(() =>
  import('@/components/visualizations/table-renderer').then((m) => ({ default: m.TableRenderer }))
)
export const WordCloudRenderer = lazy(() =>
  import('@/components/visualizations/word-cloud-renderer').then((m) => ({ default: m.WordCloudRenderer }))
)

// ── Editors ────────────────────────────────────────────────────────────────
//
// Split from the renderers rather than sharing a chunk per type: an editor is
// reached only through the edit dialog, so pairing them would put the
// configuring UI on the viewing path.

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
