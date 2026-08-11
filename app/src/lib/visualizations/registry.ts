// The one list of visualization types. Everything that used to hold its own
// copy (the renderer switch, the editor switch, the builder choices) reads
// from here instead. See docs/visualization-plugins.md.
import type { QueryResultData } from '@/lib/mock-data'
import { PLUGIN_API_VERSION, type VisualizationPlugin } from './plugin'

/**
 * Where a type came from. Not a capability: a plugin can do everything a core
 * type can, and nothing here gates behaviour. It is what the admin plugins
 * page reports, and what decides whether a name reads as `Plugin[...]` where
 * it sits beside the core types.
 */
export type VisualizationOrigin = 'core' | 'plugin'

export interface RegisteredVisualization {
  plugin: VisualizationPlugin
  origin: VisualizationOrigin
}

const registry = new Map<string, RegisteredVisualization>()

/**
 * `origin` defaults to 'plugin' because core is the only caller that can
 * honestly pass 'core', and it lives in this directory. Anything registering
 * from outside is a plugin by definition, so the default is already the right
 * answer for every out-of-tree caller rather than a field they could get
 * wrong.
 */
export function registerVisualization(
  plugin: VisualizationPlugin,
  origin: VisualizationOrigin = 'plugin'
): void {
  // An out-of-tree plugin compiled against an older interface must fail at
  // boot, where it is one log line, rather than at render, where it is a
  // blank widget nobody can explain.
  if (plugin.apiVersion !== PLUGIN_API_VERSION) {
    throw new Error(
      `Visualization plugin "${plugin.type}" targets API version ${plugin.apiVersion}, ` +
        `but this build is version ${PLUGIN_API_VERSION}.`
    )
  }
  // Throw rather than overwrite: a silent replace is how a plugin shadows a
  // core visualization by accident, and the symptom would appear far from the
  // cause.
  if (registry.has(plugin.type)) {
    throw new Error(`Visualization type "${plugin.type}" is already registered.`)
  }
  registry.set(plugin.type, { plugin, origin })
}

/**
 * Deliberately ignores the instance allowlist. Disabling a type controls what
 * can be *created*, not what can be *read*: filtering here would blank every
 * saved dashboard widget of a type an operator turned off.
 */
export function getVisualization(type: string): VisualizationPlugin | undefined {
  return registry.get(type)?.plugin
}

/**
 * What the type selector, the Visual builder and the add-widget dialog offer.
 * `enabled` is the instance allowlist; null or undefined means everything
 * registered.
 *
 * A name in `enabled` with no registered plugin is ignored rather than fatal,
 * so rolling back to an image without some plugin degrades the UI instead of
 * refusing to boot.
 */
export function listVisualizations(
  enabled?: readonly string[] | null
): VisualizationPlugin[] {
  const all = [...registry.values()].map((entry) => entry.plugin)
  if (enabled == null) return all
  const wanted = new Set(enabled)
  return all.filter((plugin) => wanted.has(plugin.type))
}

/** Registered types, in registration order. */
export function registeredTypes(): string[] {
  return [...registry.keys()]
}

/**
 * Every registered type with where it came from, in registration order.
 *
 * The admin plugins page reads this rather than a build manifest, because the
 * registry is the thing that decides what actually renders. A manifest can say
 * a plugin ships in the image while the module that registers it was never
 * imported, which is the exact failure the page exists to make visible.
 */
export function registeredVisualizations(): RegisteredVisualization[] {
  return [...registry.values()]
}

/** Where a type came from, or undefined if nothing registered it. */
export function visualizationOrigin(type: string): VisualizationOrigin | undefined {
  return registry.get(type)?.origin
}

/**
 * How a type is named where it sits beside core types.
 *
 * A plugin-supplied type reads `Plugin[Ticker]`, so a reader can tell at a
 * glance that it came from an installed package rather than from the product,
 * without having to know the registry exists. Core types are named plainly:
 * marking everything would mark nothing.
 *
 * An unregistered type falls back to its raw type string, which is what the
 * renderer already shows for one, so the two surfaces say the same thing.
 */
export function visualizationLabel(type: string): string {
  const entry = registry.get(type)
  if (!entry) return type
  return entry.origin === 'plugin' ? `Plugin[${entry.plugin.displayName}]` : entry.plugin.displayName
}

/**
 * Run a type's `validate` hook, or return no problems if it has none.
 *
 * Guarded because `validate` runs on every render of every widget, including
 * an out-of-tree plugin's. The interface says it must not throw; this makes a
 * plugin that breaks that promise degrade to "no problems reported" instead of
 * taking down a dashboard tile that was drawing fine. The throw is logged
 * rather than swallowed, so it is still diagnosable.
 */
export function validateVisualization(
  type: string,
  options: Record<string, unknown>,
  data: QueryResultData
): string[] {
  const plugin = registry.get(type)?.plugin
  if (!plugin?.validate) return []
  try {
    return plugin.validate(options, data)
  } catch (error) {
    console.error(`Visualization plugin "${type}" threw from validate()`, error)
    return []
  }
}
