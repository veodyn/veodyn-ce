/**
 * Dashboard-level parameters, derived from the mappings each widget already
 * stores under `options.parameterMappings`.
 *
 * Mapping types are Redash's:
 * - `dashboard-add-new` / `dashboard-map-to-existing` put one control on the
 *   dashboard under `mapTo`, feeding every widget bound to that name;
 * - `static-value` is fixed by whoever added the widget and never rendered;
 * - `widget-level` belongs to the widget alone.
 *
 * Every widget gets a value for every parameter its query declares, mapped or
 * not. `ParameterizedQuery.missing_params` applies no defaults, so a saved
 * query executed with a parameter missing is refused outright rather than run
 * with the value it was saved with.
 */
import type { MockQueryParameter, ParameterValue } from '@/lib/mock-data'

export interface WidgetLike {
  options: { parameterMappings?: Record<string, unknown> }
  visualization?: {
    query: {
      id: number
      options?: { parameters?: MockQueryParameter[] }
    }
  }
}

interface MappingEntry {
  type?: string
  mapTo?: string
  value?: ParameterValue
  title?: string
}

const DASHBOARD_KINDS = ['dashboard-add-new', 'dashboard-map-to-existing']

function mappingsOf(widget: WidgetLike): Record<string, MappingEntry> {
  const raw = widget.options?.parameterMappings
  return raw && typeof raw === 'object' ? (raw as Record<string, MappingEntry>) : {}
}

function parametersOf(widget: WidgetLike): MockQueryParameter[] {
  return widget.visualization?.query?.options?.parameters ?? []
}

/**
 * The controls to render above the grid: one per distinct `mapTo`, carrying the
 * source parameter's own definition so the right control is drawn (an enum
 * without its options can only be a text box, which means typing a value that
 * has to match an option exactly).
 */
export function collectDashboardParameters(widgets: WidgetLike[]): MockQueryParameter[] {
  const byName = new Map<string, MockQueryParameter>()

  for (const widget of widgets) {
    const definitions = parametersOf(widget)
    for (const [paramName, mapping] of Object.entries(mappingsOf(widget))) {
      if (!DASHBOARD_KINDS.includes(mapping?.type ?? '')) continue

      const definition = definitions.find((p) => p.name === paramName)
      // A mapping left behind by a parameter that has since been renamed or
      // removed. Rendering it would offer a control for something no query
      // reads, so it is dropped rather than guessed at.
      if (!definition) continue

      const name = mapping.mapTo || paramName
      if (byName.has(name)) continue
      byName.set(name, { ...definition, name, title: mapping.title || definition.title })
    }
  }

  return [...byName.values()]
}

/** What to send for one widget, given the dashboard-level values. */
export function widgetParameters(
  widget: WidgetLike,
  dashboardValues: Record<string, unknown>
): Record<string, unknown> {
  const mappings = mappingsOf(widget)
  const values: Record<string, unknown> = {}

  // Keyed off the query's own parameters rather than off the mappings, so a
  // widget with no mappings at all still sends the defaults it was saved with
  // instead of being refused for missing values.
  for (const definition of parametersOf(widget)) {
    const mapping = mappings[definition.name]

    if (mapping?.type === 'static-value') {
      values[definition.name] = mapping.value
      continue
    }

    if (DASHBOARD_KINDS.includes(mapping?.type ?? '')) {
      const name = mapping?.mapTo || definition.name
      // Missing beats wrong: a dashboard value not set yet must not erase the
      // default the query was saved with.
      values[definition.name] = name in dashboardValues ? dashboardValues[name] : definition.value
      continue
    }

    values[definition.name] = definition.value
  }

  return values
}
