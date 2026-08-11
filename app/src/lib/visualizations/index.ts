// Import visualizations from HERE, not from ./registry directly.
//
// Registration is a side effect of importing ./core. A module that reaches
// past this barrel straight into ./registry can observe an empty registry,
// depending on import order, and the symptom is every visualization rendering
// as "unsupported type" in one route and fine in another.
import './core'

// This barrel deliberately does NOT import '@/plugins'. It reads like the one
// place that would guarantee registration everywhere, and it cannot be: a
// plugin imports this module, so importing the plugin seam from here is a
// cycle. Under it, a plugin's object literal evaluates while this module's
// exports are still being assigned and reads PLUGIN_API_VERSION as `undefined`,
// which registration then rejects as "targets API version undefined". Measured,
// not theorised. Installation lives with the two consumers instead: see
// src/plugins/index.ts.
export { CORE_VISUALIZATIONS } from './core'
// Re-exported so a plugin can declare a Visual builder tile without importing
// from '@/components/visualizations/*'. VisualizationChoice.Thumbnail needs
// this type, so without it the only way to supply a tile was to cross the
// boundary the plugin layer exists to draw.
export type { VizThumbnail } from '@/components/visualizations/viz-thumbnails'
// Same reason as VizThumbnail above: a plugin that paints its own colours has
// to know which theme is live, and the alternative was every plugin reading
// prefers-color-scheme for itself. That is what they did do, and it meant a
// reader on a dark app with a light OS got a black page holding a white map.
// Exposed as plugin API rather than allowed as an app import, so a plugin still
// depends only on this barrel.
export {
  useThemeScope as useVisualizationTheme,
  type ThemeScope as VisualizationTheme,
} from '@/components/theme/theme-provider'
export { WidgetThemeBoundary } from '@/components/theme/widget-theme-boundary'
export {
  WIDGET_THEMES,
  WIDGET_THEME_LABELS,
  DEFAULT_WIDGET_THEME,
  readWidgetTheme,
  resolveWidgetTheme,
  type WidgetTheme,
} from '@/lib/widget-theme'
export {
  PLUGIN_API_VERSION,
  type VisualizationAudience,
  type VisualizationChoice,
  type VisualizationEditorProps,
  type VisualizationPlugin,
  type VisualizationRendererProps,
} from './plugin'
export {
  EMPTY_QUERY_RESULT,
  needsQueryResult,
  visualizationData,
  type VisualizationDataOptions,
} from './data-gate'
export { inferredVizOptions } from './infer'
export {
  sanitizeOptions,
  type OptionRule,
  type OptionSchema,
} from './option-schema'
export {
  getVisualization,
  listVisualizations,
  registerVisualization,
  registeredTypes,
  registeredVisualizations,
  validateVisualization,
  visualizationLabel,
  visualizationOrigin,
  type RegisteredVisualization,
  type VisualizationOrigin,
} from './registry'
export { missingMappedColumns, missingNamedColumns } from './validate-columns'
