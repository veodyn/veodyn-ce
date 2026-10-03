import type { VizThumbnail } from '@veodyn/viz/components/visualizations/viz-thumbnails'
import { CORE_CHOICE_GUIDES } from '@veodyn/viz/lib/visualizations/choice-guides'
import {
  listVisualizations,
  registeredTypes,
  type VisualizationAudience,
  type VisualizationPlugin,
} from '@veodyn/viz'

export interface VizChoice {
  id: string
  label: string
  type: string
  options: Record<string, unknown>
  Thumbnail: VizThumbnail
  guide?: string
}

export interface VisualizationVisibility {
  enabled?: readonly string[] | null
  audience?: Readonly<Record<string, VisualizationAudience>> | null
}

export interface AdhocViz {
  type: string
  name: string
  options: Record<string, unknown>
}

function choicesOf(plugins: readonly VisualizationPlugin[]): VizChoice[] {
  return plugins.flatMap((plugin) =>
    (plugin.choices ?? []).map((choice) => ({
      id: choice.id,
      label: choice.label,
      type: plugin.type,
      options: choice.options,
      Thumbnail: choice.Thumbnail,
      guide: choice.guide ?? CORE_CHOICE_GUIDES[choice.id],
    }))
  )
}

export function allVizChoices(): VizChoice[] {
  return choicesOf(listVisualizations())
}

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

export function effectiveAudience(
  plugin: VisualizationPlugin,
  overrides?: VisualizationVisibility['audience']
): VisualizationAudience {
  return overrides?.[plugin.type] ?? plugin.audience ?? 'analyst'
}

export function visibleVisualizations(
  visibility?: VisualizationVisibility | null
): VisualizationPlugin[] {
  const enabled = visibility?.enabled
  if (enabled != null) warnUnknownTypes(enabled)
  return listVisualizations(enabled).filter(
    (plugin) => effectiveAudience(plugin, visibility?.audience) === 'analyst'
  )
}

export function visibleVizChoices(visibility?: VisualizationVisibility | null): VizChoice[] {
  return choicesOf(visibleVisualizations(visibility))
}

export const DEFAULT_VIZ_ID = 'table'

export function resolveVizChoice(id: string): VizChoice {
  const choices = allVizChoices()
  return (
    choices.find((choice) => choice.id === id) ??
    choices.find((choice) => choice.id === DEFAULT_VIZ_ID) ??
    choices[0]
  )
}

export function adhocVizFor(id: string): AdhocViz {
  const choice = resolveVizChoice(id)
  return { type: choice.type, name: choice.label, options: choice.options }
}

export function isSavedVisualization(viz: { id: number }): boolean {
  return viz.id > 0
}
