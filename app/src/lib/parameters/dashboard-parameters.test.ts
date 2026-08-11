/**
 * Dashboard-level parameters, built from what the widgets already store.
 *
 * The add-widget dialog has always written `options.parameterMappings`, and
 * nothing ever read them: the dashboard rendered no parameter bar and every
 * widget executed with no parameters at all. That is not merely a missing
 * feature. `ParameterizedQuery.missing_params` applies no defaults, so a
 * parameterised query run with nothing supplied comes back as
 * "Missing parameter value for: x" as soon as a fresh execution is needed.
 *
 * Mapping types come from Redash: the two `dashboard-*` kinds put one control
 * on the dashboard and feed every widget bound to it, `static-value` is fixed
 * and never rendered, and `widget-level` belongs to the widget alone.
 */
import { describe, expect, it } from 'vitest'
import type { MockQueryParameter } from '@/lib/mock-data'
import { collectDashboardParameters, widgetParameters, type WidgetLike } from './dashboard-parameters'

function widget(
  mappings: Record<string, unknown> | undefined,
  parameters: MockQueryParameter[] = []
): WidgetLike {
  return {
    options: { parameterMappings: mappings },
    visualization: { query: { id: 1, options: { parameters } } },
  }
}

const CITY = { name: 'city', title: 'City', type: 'enum', value: 'A', enumOptions: 'A\nB\nC' }
const WINDOW = { name: 'window', title: 'Window', type: 'date-range', value: 'd_last_7_days' }

describe('collectDashboardParameters', () => {
  it('promotes a dashboard-mapped parameter under the name it maps to', () => {
    const params = collectDashboardParameters([
      widget({ city: { type: 'dashboard-add-new', mapTo: 'region', title: 'Region' } }, [CITY]),
    ])

    expect(params).toHaveLength(1)
    expect(params[0]).toMatchObject({ name: 'region', title: 'Region' })
  })

  // Without the source definition the bar can only draw a text box, which for
  // an enum means typing a value that has to match an option exactly.
  it('keeps the source parameter definition so the right control renders', () => {
    const params = collectDashboardParameters([
      widget({ city: { type: 'dashboard-add-new', mapTo: 'region' } }, [CITY]),
    ])

    expect(params[0]).toMatchObject({ type: 'enum', enumOptions: 'A\nB\nC', value: 'A' })
  })

  // The whole point of a dashboard parameter: one control driving several
  // widgets, not one control per widget that happens to share a name.
  it('renders one control when two widgets map to the same name', () => {
    const params = collectDashboardParameters([
      widget({ city: { type: 'dashboard-add-new', mapTo: 'region' } }, [CITY]),
      widget({ town: { type: 'dashboard-map-to-existing', mapTo: 'region' } }, [
        { ...CITY, name: 'town' },
      ]),
    ])

    expect(params.map((p) => p.name)).toEqual(['region'])
  })

  it('leaves static and widget-level mappings off the dashboard', () => {
    const params = collectDashboardParameters([
      widget(
        {
          city: { type: 'static-value', value: 'A' },
          window: { type: 'widget-level' },
        },
        [CITY, WINDOW]
      ),
    ])

    expect(params).toEqual([])
  })

  it('ignores a mapping whose query parameter no longer exists', () => {
    const params = collectDashboardParameters([
      widget({ gone: { type: 'dashboard-add-new', mapTo: 'gone' } }, [CITY]),
    ])

    expect(params).toEqual([])
  })

  it('has nothing to show for a text widget', () => {
    expect(collectDashboardParameters([{ options: {} } as WidgetLike])).toEqual([])
  })
})

describe('widgetParameters', () => {
  it('feeds the dashboard value in under the query parameter name', () => {
    const w = widget({ city: { type: 'dashboard-add-new', mapTo: 'region' } }, [CITY])

    expect(widgetParameters(w, { region: 'B' })).toEqual({ city: 'B' })
  })

  it('sends a static value regardless of the dashboard', () => {
    const w = widget({ city: { type: 'static-value', value: 'C' } }, [CITY])

    expect(widgetParameters(w, { region: 'B' })).toEqual({ city: 'C' })
  })

  // Missing beats wrong: a dashboard value that has not been set yet must not
  // erase the default the query was saved with.
  it('falls back to the query default when the dashboard value is unset', () => {
    const w = widget({ city: { type: 'dashboard-add-new', mapTo: 'region' } }, [CITY])

    expect(widgetParameters(w, {})).toEqual({ city: 'A' })
  })

  // The case that is broken today: no mappings at all, so nothing was sent and
  // the backend answered "Missing parameter value for: city".
  it('sends the query defaults for a widget with no mappings', () => {
    const w = widget(undefined, [CITY, WINDOW])

    expect(widgetParameters(w, {})).toEqual({ city: 'A', window: 'd_last_7_days' })
  })

  it('sends its own default for a widget-level parameter', () => {
    const w = widget({ window: { type: 'widget-level' } }, [WINDOW])

    expect(widgetParameters(w, {})).toEqual({ window: 'd_last_7_days' })
  })

  it('has nothing to send for a query without parameters', () => {
    expect(widgetParameters(widget(undefined, []), { region: 'B' })).toEqual({})
  })
})
