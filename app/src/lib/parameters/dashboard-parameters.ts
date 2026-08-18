/**
 * Dashboard-level parameters, derived from each widget's
 * `options.parameterMappings`.
 *
 * Redash mapping types: `dashboard-add-new` / `dashboard-map-to-existing` put
 * one control on the dashboard under `mapTo`, feeding every widget bound to
 * that name; `static-value` is fixed and never rendered; `widget-level` belongs
 * to the widget alone.
 *
 * `ParameterizedQuery.missing_params` applies no defaults, so a query run with
 * a parameter missing is refused rather than run with its saved value.
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
 * source parameter's own definition so the right control is drawn.
 */
export function collectDashboardParameters(widgets: WidgetLike[]): MockQueryParameter[] {
  const byName = new Map<string, MockQueryParameter>()

  for (const widget of widgets) {
    const definitions = parametersOf(widget)
    for (const [paramName, mapping] of Object.entries(mappingsOf(widget))) {
      if (!DASHBOARD_KINDS.includes(mapping?.type ?? '')) continue

      const definition = definitions.find((p) => p.name === paramName)
      // A mapping left behind by a renamed or removed parameter: no query
      // reads it, so it gets no control.
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

  // Keyed off the query's parameters, not the mappings: a widget with no
  // mappings still has to send a value for every one of them.
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
