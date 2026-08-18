// What the Visual builder offers, flattened from the registry. A chart shape is
// a Redash *option* (`globalSeriesType` in a CHART's options), not a type, so
// one CHART type yields several tiles. VisualQuerySpec.chartType still means a
// Redash type.
//
// Instance visibility (`visualizations.enabled`, `visualizations.audience`) is
// applied here, the CREATION side only: `getVisualization` and the renderer
// stay unfiltered, so a widget saved before an operator hid its type still
// draws.
import type { VizThumbnail } from '@/components/visualizations/viz-thumbnails'
import {
  listVisualizations,
  registeredTypes,
  type VisualizationAudience,
  type VisualizationPlugin,
} from '@/lib/visualizations'

export interface VizChoice {
  /** Stable id held in the builder's draft. Not a Redash type. */
  id: string
  /** What the tile reads, and what the resulting visualization is named. */
  label: string
  /** The Redash visualization type this produces. */
  type: string
  /** Options layered over the type's defaults. Empty for most choices. */
  options: Record<string, unknown>
  Thumbnail: VizThumbnail
}

/**
 * The instance's view of which types may be created, as it arrives from
 * `useConfig().visualizations`. Both fields travel together: passing only
 * `enabled` skips the audience rule.
 */
export interface VisualizationVisibility {
  /** Allowlist. Null or undefined means everything registered. */
  enabled?: readonly string[] | null
  /** Per-type overrides of the audience a plugin declares for itself. */
  audience?: Readonly<Record<string, VisualizationAudience>> | null
}

/** A visualization to build for an ad hoc run: the resolved form of a choice. */
export interface AdhocViz {
  type: string
  name: string
  options: Record<string, unknown>
}

// A plugin with no choices is absent from the builder (nothing to draw), but is
// still creatable from the type selector in the edit dialog.
function choicesOf(plugins: readonly VisualizationPlugin[]): VizChoice[] {
  return plugins.flatMap((plugin) =>
    (plugin.choices ?? []).map((choice) => ({
      id: choice.id,
      label: choice.label,
      type: plugin.type,
      options: choice.options,
      Thumbnail: choice.Thumbnail,
    }))
  )
}

/** Every tile this build can draw, before any instance visibility rule. */
export const VIZ_CHOICES: VizChoice[] = choicesOf(listVisualizations())

// One warning per unrecognized name per process: the allowlist does not change
// while the app runs, so re-warning on every picker render is pure noise.
const warnedUnknownTypes = new Set<string>()

function warnUnknownTypes(enabled: readonly string[]): void {
  const registered = new Set(registeredTypes())
  for (const name of enabled) {
    if (registered.has(name) || warnedUnknownTypes.has(name)) continue
    warnedUnknownTypes.add(name)
    console.warn(
      `[config] visualizations.enabled names "${name}", which no visualization plugin in this ` +
        'build registers. Ignoring it.'
    )
  }
}

/**
 * Who a type is offered to. Config overrides the plugin's own declaration in
 * both directions; a type that declares nothing is for analysts.
 */
export function effectiveAudience(
  plugin: VisualizationPlugin,
  overrides?: VisualizationVisibility['audience']
): VisualizationAudience {
  return overrides?.[plugin.type] ?? plugin.audience ?? 'analyst'
}

/**
 * The visualization types an instance offers for CREATION. An `enabled` name
 * with no registered plugin is ignored rather than thrown on, so a rollback
 * degrades the UI instead of stopping the app. Internal types are dropped here
 * and nowhere else: they stay registered and keep rendering.
 */
export function visibleVisualizations(
  visibility?: VisualizationVisibility | null
): VisualizationPlugin[] {
  const enabled = visibility?.enabled
  if (enabled != null) warnUnknownTypes(enabled)
  return listVisualizations(enabled).filter(
    (plugin) => effectiveAudience(plugin, visibility?.audience) === 'analyst'
  )
}

/**
 * The builder tiles an instance offers, under the same rules. An empty
 * allowlist means an empty grid, not everything.
 */
export function visibleVizChoices(visibility?: VisualizationVisibility | null): VizChoice[] {
  return choicesOf(visibleVisualizations(visibility))
}

export const DEFAULT_VIZ_ID = 'table'

/**
 * The choice for an id, falling back to the table rather than throwing on a
 * stale draft. The fallback is looked up by id, not taken as the first tile,
 * because tile order follows registration order. Reads the unfiltered list, so
 * a draft naming a hidden type still resolves.
 */
export function resolveVizChoice(id: string): VizChoice {
  return (
    VIZ_CHOICES.find((choice) => choice.id === id) ??
    VIZ_CHOICES.find((choice) => choice.id === DEFAULT_VIZ_ID) ??
    VIZ_CHOICES[0]
  )
}

/** What a run should show for a picked choice. */
export function adhocVizFor(id: string): AdhocViz {
  const choice = resolveVizChoice(id)
  return { type: choice.type, name: choice.label, options: choice.options }
}
