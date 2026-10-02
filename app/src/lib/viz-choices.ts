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
import { CORE_CHOICE_GUIDES } from '@/lib/visualizations/choice-guides'
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
  /**
   * When the chat model should pick this shape. Absent for a choice nobody has
   * written one for; see VisualizationChoice.guide and ./visualizations/choice-guides.
   */
  guide?: string
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
      // The choice's own guide wins. CORE_CHOICE_GUIDES is not a default for
      // plugins to inherit, it is where the core types keep theirs because
      // core.ts has no room for them; a plugin id will never be in it.
      guide: choice.guide ?? CORE_CHOICE_GUIDES[choice.id],
    }))
  )
}

/**
 * Every tile this build can draw, before any instance visibility rule.
 *
 * A FUNCTION, and it has to stay one. This was a module-level const, evaluated
 * the first time this module was imported, and that is a trap with a very quiet
 * failure: registration is a side effect of importing `@/plugins`, which
 * providers.tsx does LAST among its imports, so any module that reached
 * viz-choices.ts earlier in the graph froze the list to the core types. A
 * plugin's choice then resolved to the table, which is indistinguishable from
 * the plugin not being installed.
 *
 * Nothing caught it because no plugin had ever declared a choice. The moment
 * one did, the chat model was offered a shape the frontend then refused to
 * draw — the exact bug this whole change exists to fix, reintroduced one layer
 * down. Reading the registry per call costs an array build on a list of
 * fourteen and cannot go stale.
 */
export function allVizChoices(): VizChoice[] {
  return choicesOf(listVisualizations())
}

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
  const choices = allVizChoices()
  return (
    choices.find((choice) => choice.id === id) ??
    choices.find((choice) => choice.id === DEFAULT_VIZ_ID) ??
    choices[0]
  )
}

/** What a run should show for a picked choice. */
export function adhocVizFor(id: string): AdhocViz {
  const choice = resolveVizChoice(id)
  return { type: choice.type, name: choice.label, options: choice.options }
}

/**
 * Whether a visualization is a saved row the backend has, as opposed to one of
 * the synthetic tabs an ad hoc run builds: the table at id 0 and the builder's
 * chart at -1 (see adhocVisualizations in query-editor-results.tsx, which owns
 * that convention). Only a saved one can be edited, deleted or published; the
 * synthetic ids have no row behind them, so any request against them can only
 * 404.
 */
export function isSavedVisualization(viz: { id: number }): boolean {
  return viz.id > 0
}
