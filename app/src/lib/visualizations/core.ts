// The visualization types that ship with the OSS product. Nothing
// tenant-specific belongs here; an instance adds its own by importing its
// plugin package alongside this one. See docs/visualization-plugins.md.
import {
  BarChart3, BoxSelect, Cloud, GitBranch, Globe, Grid3x3, Hash, Info,
  LayoutGrid, MapPin, PieChart, Table2, Workflow,
} from 'lucide-react'
import { chartShapeProblems } from '@/components/visualizations/chart/chart-shape'
import { inferChartColumnMapping } from '@/components/visualizations/chart/resolve-config'
import type { RedashChartOptions } from '@/services/redash/visualization-options'
import {
  AreaThumbnail, BarThumbnail, BoxPlotThumbnail, CounterThumbnail, DetailsThumbnail,
  FunnelThumbnail, HeatmapThumbnail, LineThumbnail, MapThumbnail, PieThumbnail,
  PivotThumbnail, SankeyThumbnail, ScatterThumbnail, TableThumbnail,
} from '@/components/visualizations/viz-thumbnails'
import { inferHeatmapColumnMapping } from '@/components/visualizations/heatmap-column-mapping'
// Every Renderer and Editor below is loaded on demand. The thumbnails, icons
// and inference helpers above stay eager because they are what the type
// selector and the Visual builder draw before anything is chosen, and they are
// plain SVG and arithmetic. See ./lazy-components.ts for why the split exists.
import {
  BoxPlotEditor, BoxPlotRenderer, ChartEditor, ChartRenderer, ChoroplethEditor,
  ChoroplethRenderer, CohortEditor, CohortRenderer, CounterEditor, CounterRenderer,
  DetailsEditor, DetailsRenderer, FunnelEditor, FunnelRenderer, HeatmapEditor,
  HeatmapRenderer, MapEditor, MapRenderer, PivotEditor, PivotRenderer, SankeyEditor,
  SankeyRenderer, SunburstEditor, SunburstRenderer, TableEditor, TableRenderer,
  WordCloudEditor, WordCloudRenderer,
} from './lazy-components'
import { CORE_PUBLIC_OPTIONS, NAMED_COLUMNS } from './core-options'
import { KPI_HISTORY_VISUALIZATION } from './kpi-history'
import { PLUGIN_API_VERSION, type VisualizationPlugin } from './plugin'
import { registerVisualization } from './registry'
import { missingMappedColumns, missingNamedColumns } from './validate-columns'

const V = PLUGIN_API_VERSION

/**
 * Registration order is the order the type selector and the Visual builder
 * present, so it is the previous hand-written order of VISUALIZATION_TYPES
 * and VIZ_CHOICES rather than anything alphabetical.
 */
export const CORE_VISUALIZATIONS: VisualizationPlugin[] = [
  {
    apiVersion: V,
    type: 'TABLE',
    displayName: 'Table',
    icon: Table2,
    defaultOptions: {},
    publicOptions: CORE_PUBLIC_OPTIONS.TABLE,
    Renderer: TableRenderer,
    Editor: TableEditor,
    choices: [{ id: 'table', label: 'Table', options: {}, Thumbnail: TableThumbnail }],
  },
  {
    apiVersion: V,
    type: 'CHART',
    displayName: 'Chart',
    icon: BarChart3,
    defaultOptions: { globalSeriesType: 'line', columnMapping: {} },
    publicOptions: CORE_PUBLIC_OPTIONS.CHART,
    Renderer: ChartRenderer,
    Editor: ChartEditor,
    // Two independent reasons a chart is not the chart that was asked for: a
    // column that is no longer in the result, and a shape Redash can store that
    // this app cannot draw. The second used to be silent, so a Redash-authored
    // bar chart (globalSeriesType 'column') drew as a line and said nothing.
    validate: (options, data) => [
      ...missingMappedColumns(options, data),
      ...chartShapeProblems(options as RedashChartOptions),
    ],
    // A chart with no mapping drew nothing while the editor claimed to be
    // unconfigured. Seed it, but never over a mapping the analyst already set.
    inferOptions(defaults, data) {
      const mapping = defaults.columnMapping as Record<string, string> | undefined
      if (mapping != null && Object.keys(mapping).length > 0) return defaults
      const inferred = inferChartColumnMapping(data)
      if (Object.keys(inferred).length === 0) return defaults
      return { ...defaults, columnMapping: inferred }
    },
    choices: [
      { id: 'chart-line', label: 'Line', options: { globalSeriesType: 'line' }, Thumbnail: LineThumbnail },
      { id: 'chart-bar', label: 'Bar', options: { globalSeriesType: 'bar' }, Thumbnail: BarThumbnail },
      { id: 'chart-area', label: 'Area', options: { globalSeriesType: 'area' }, Thumbnail: AreaThumbnail },
      { id: 'chart-pie', label: 'Pie', options: { globalSeriesType: 'pie' }, Thumbnail: PieThumbnail },
      { id: 'chart-scatter', label: 'Scatter', options: { globalSeriesType: 'scatter' }, Thumbnail: ScatterThumbnail },
    ],
  },
  {
    apiVersion: V,
    type: 'COUNTER',
    displayName: 'Counter',
    icon: Hash,
    defaultOptions: { counterColName: '', counterLabel: '', rowNumber: 1 },
    publicOptions: CORE_PUBLIC_OPTIONS.COUNTER,
    Renderer: CounterRenderer,
    Editor: CounterEditor,
    validate: (options, data) => missingNamedColumns(options, NAMED_COLUMNS.COUNTER, data),
    choices: [{ id: 'counter', label: 'Counter', options: {}, Thumbnail: CounterThumbnail }],
  },
  {
    apiVersion: V,
    type: 'PIVOT',
    displayName: 'Pivot Table',
    icon: Table2,
    defaultOptions: { rowField: '', colField: '', valueField: '', aggregation: 'sum' },
    publicOptions: CORE_PUBLIC_OPTIONS.PIVOT,
    Renderer: PivotRenderer,
    Editor: PivotEditor,
    validate: (options, data) => missingNamedColumns(options, NAMED_COLUMNS.PIVOT, data),
    choices: [{ id: 'pivot', label: 'Pivot', options: {}, Thumbnail: PivotThumbnail }],
  },
  {
    apiVersion: V,
    type: 'FUNNEL',
    displayName: 'Funnel',
    icon: GitBranch,
    defaultOptions: { stepColumn: '', valueColumn: '', sortOrder: 'desc' },
    publicOptions: CORE_PUBLIC_OPTIONS.FUNNEL,
    Renderer: FunnelRenderer,
    Editor: FunnelEditor,
    validate: (options, data) => missingNamedColumns(options, NAMED_COLUMNS.FUNNEL, data),
    choices: [{ id: 'funnel', label: 'Funnel', options: {}, Thumbnail: FunnelThumbnail }],
  },
  {
    apiVersion: V,
    type: 'DETAILS',
    displayName: 'Details',
    icon: Info,
    defaultOptions: { columns: [] },
    publicOptions: CORE_PUBLIC_OPTIONS.DETAILS,
    Renderer: DetailsRenderer,
    Editor: DetailsEditor,
    choices: [{ id: 'details', label: 'Details', options: {}, Thumbnail: DetailsThumbnail }],
  },
  {
    apiVersion: V,
    type: 'MAP',
    displayName: 'Map (Markers)',
    icon: MapPin,
    defaultOptions: { latColName: 'lat', lonColName: 'lon', popup: { enabled: true } },
    publicOptions: CORE_PUBLIC_OPTIONS.MAP,
    Renderer: MapRenderer,
    Editor: MapEditor,
    validate: (options, data) => missingNamedColumns(options, NAMED_COLUMNS.MAP, data),
    choices: [{ id: 'map', label: 'Map', options: {}, Thumbnail: MapThumbnail }],
  },
  {
    apiVersion: V,
    type: 'HEATMAP',
    displayName: 'Heatmap',
    icon: Grid3x3,
    defaultOptions: { columnMapping: {} },
    publicOptions: CORE_PUBLIC_OPTIONS.HEATMAP,
    Renderer: HeatmapRenderer,
    Editor: HeatmapEditor,
    validate: (options, data) => missingMappedColumns(options, data),
    // Same contract as the chart's: seed the mapping, never touch one the
    // analyst already set. heatmap-model.ts resolves an empty mapping
    // positionally, so this changes nothing that already draws; it exists so a
    // heatmap created without an editor (an AI-authored widget) says which
    // columns it is of, and picks the measure by aggregate rather than by
    // position.
    inferOptions(defaults, data) {
      const mapping = defaults.columnMapping as Record<string, string> | undefined
      if (mapping != null && Object.keys(mapping).length > 0) return defaults
      const inferred = inferHeatmapColumnMapping(data)
      if (Object.keys(inferred).length === 0) return defaults
      return { ...defaults, columnMapping: inferred }
    },
    choices: [{ id: 'heatmap', label: 'Heatmap', options: {}, Thumbnail: HeatmapThumbnail }],
  },
  {
    apiVersion: V,
    type: 'BOXPLOT',
    displayName: 'Box Plot',
    icon: BoxSelect,
    defaultOptions: { columnMapping: {} },
    publicOptions: CORE_PUBLIC_OPTIONS.BOXPLOT,
    Renderer: BoxPlotRenderer,
    Editor: BoxPlotEditor,
    validate: (options, data) => missingMappedColumns(options, data),
    choices: [{ id: 'boxplot', label: 'Box Plot', options: {}, Thumbnail: BoxPlotThumbnail }],
  },
  {
    apiVersion: V,
    type: 'SANKEY',
    displayName: 'Sankey',
    icon: Workflow,
    defaultOptions: { columnMapping: {} },
    publicOptions: CORE_PUBLIC_OPTIONS.SANKEY,
    Renderer: SankeyRenderer,
    Editor: SankeyEditor,
    validate: (options, data) => missingMappedColumns(options, data),
    choices: [{ id: 'sankey', label: 'Sankey', options: {}, Thumbnail: SankeyThumbnail }],
  },

  // These four had a renderer and nothing else: they drew when a saved
  // visualization already carried the type, but could not be created or
  // edited. Their editors are added with the rest of this phase.
  //
  // defaultOptions deliberately omit the column keys rather than seeding them
  // with ''. Several of these renderers fall back with `?? `, which treats an
  // empty string as a real answer and defeats their own auto-detection.
  {
    apiVersion: V,
    type: 'CHOROPLETH',
    displayName: 'Choropleth',
    icon: Globe,
    // targetField is seeded because choropleth-model joins on
    // `feature.properties[targetField]` and leaves the key undefined without
    // it, so an unseeded choropleth matches nothing and renders "No regions
    // matched the key column". public/geo/world-countries.geojson carries
    // name, iso_a2 and iso_a3; name is the one a human-written query column
    // is most likely to hold.
    defaultOptions: { mapType: 'world-countries', targetField: 'name' },
    publicOptions: CORE_PUBLIC_OPTIONS.CHOROPLETH,
    Renderer: ChoroplethRenderer,
    Editor: ChoroplethEditor,
    // defaultOptions only reach a visualization at creation, so seeding
    // targetField does nothing for the choropleths saved before it existed.
    // Those still match zero regions, and the renderer blames the key column.
    // Saying so is the only thing that reaches them without rewriting stored
    // options behind the analyst's back.
    validate: (options, data) => {
      const problems = missingNamedColumns(options, NAMED_COLUMNS.CHOROPLETH, data)
      if (!options.targetField) {
        problems.push(
          'No map property is selected, so no region can match. Pick one under "Matched Against".'
        )
      }
      return problems
    },
  },
  {
    apiVersion: V,
    type: 'COHORT',
    displayName: 'Cohort',
    icon: LayoutGrid,
    defaultOptions: {},
    publicOptions: CORE_PUBLIC_OPTIONS.COHORT,
    Renderer: CohortRenderer,
    Editor: CohortEditor,
    validate: (options, data) => missingNamedColumns(options, NAMED_COLUMNS.COHORT, data),
  },
  {
    apiVersion: V,
    type: 'SUNBURST_SEQUENCE',
    displayName: 'Sunburst',
    icon: PieChart,
    defaultOptions: {},
    publicOptions: CORE_PUBLIC_OPTIONS.SUNBURST_SEQUENCE,
    Renderer: SunburstRenderer,
    Editor: SunburstEditor,
    validate: (options, data) => missingNamedColumns(options, NAMED_COLUMNS.SUNBURST, data),
  },
  {
    apiVersion: V,
    type: 'WORD_CLOUD',
    displayName: 'Word Cloud',
    icon: Cloud,
    defaultOptions: {},
    publicOptions: CORE_PUBLIC_OPTIONS.WORD_CLOUD,
    Renderer: WordCloudRenderer,
    Editor: WordCloudEditor,
    validate: (options, data) => missingNamedColumns(options, NAMED_COLUMNS.WORD_CLOUD, data),
  },

  // Declared in its own module rather than inline: this file is at the limit
  // the file-size hook enforces, and a new type with no existing importers is
  // the cheapest thing to move out. See ./kpi-history.ts.
  KPI_HISTORY_VISUALIZATION,
]

for (const plugin of CORE_VISUALIZATIONS) {
  registerVisualization(plugin, 'core')
}
