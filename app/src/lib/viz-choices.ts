// What the Visual builder offers as a visualization, which is not the same list
// as the registered types.
//
// A chart shape is a Redash *option*, not a type: `globalSeriesType` lives in a
// CHART visualization's options. So the registry has one CHART type while an
// analyst thinks in five shapes. Each plugin declares its own builder tiles, so
// this is now a flattening of the registry rather than a second hand-written
// list that could disagree with it. VisualQuerySpec.chartType keeps meaning a
// Redash type, so an AI-authored spec is unaffected by anything here.
//
// This module is also where instance visibility is applied, for both the
// builder tiles and the type selector: the `visualizations.enabled` allowlist
// and the `visualizations.audience` overrides. It is the CREATION side of the
// registry: `getVisualization` and the renderer stay unfiltered on purpose, so
// a widget saved before an operator hid its type still draws.
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
 * `useConfig().visualizations`.
 *
 * Taken as one object rather than as loose arguments because the two fields
 * are read together everywhere and answer halves of the same question. Passing
 * only `enabled`, which is what every caller used to do, silently skipped the
 * audience rule.
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

// A plugin with no choices is absent from the builder by design: the builder is
// a grid of pictures and would have nothing to draw for it. Such a type is
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

// One warning per unrecognized name per process. The allowlist is instance
// config: it does not change while the app runs, so the same name would warn on
// every render of every picker and bury the one line an operator needs to read.
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
 * Who a type is offered to, once the instance has had its say.
 *
 * Config wins over the plugin's own declaration, in both directions: an
 * instance can promote a type its author called internal, or demote one it
 * did not. A type that declares nothing is for analysts, which keeps every
 * plugin written before this field existed exactly where it was.
 */
export function effectiveAudience(
  plugin: VisualizationPlugin,
  overrides?: VisualizationVisibility['audience']
): VisualizationAudience {
  return overrides?.[plugin.type] ?? plugin.audience ?? 'analyst'
}

/**
 * The visualization types an instance offers for CREATION: the type selector in
 * the edit dialog, and the source of the builder tiles below.
 *
 * A name in `enabled` with no registered plugin is warned about once and
 * ignored rather than throwing, so rolling back to an image without some plugin
 * degrades the UI instead of stopping the app.
 *
 * Internal types are dropped here and nowhere else. They stay registered, keep
 * rendering, and are still reachable by anything that names a type directly (an
 * API call, a dashboard promoted from another instance); they are simply not
 * offered to someone picking one.
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
 * allowlist means an empty grid, not everything: a list that names nothing is
 * still a list.
 */
export function visibleVizChoices(visibility?: VisualizationVisibility | null): VizChoice[] {
  return choicesOf(visibleVisualizations(visibility))
}

export const DEFAULT_VIZ_ID = 'table'

/**
 * The choice for an id, falling back to the table rather than throwing. A draft
 * carrying an id this build no longer offers is a stale value, and answering it
 * with the plainest visualization is better than taking the editor down.
 *
 * The fallback looks the default up by id rather than taking the first tile:
 * tile order now comes from registration order, and "first" would quietly stop
 * meaning the table the day someone registers a plugin ahead of it.
 *
 * Deliberately reads the unfiltered list: a draft written before an operator
 * hid a type still resolves to what it says, the same way a saved
 * visualization of a hidden type still renders.
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
