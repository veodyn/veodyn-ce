/**
 * The fixtures have to exercise this, or mock mode (which is what the suite and
 * the Playwright baseline run against) shows a dashboard with no parameters and
 * nothing catches a regression in the wiring.
 */
import { describe, expect, it } from 'vitest'
import { mockDashboards } from '@/lib/mock-data'
import { collectDashboardParameters, widgetParameters } from './dashboard-parameters'

// Dashboard 3, not 1: dashboard 1 is the wall/present fixture, whose tests
// assert its widget count.
const dashboard = mockDashboards.find((d) => d.id === 3)

describe('the fixture dashboard', () => {
  it('promotes exactly the parameters its widgets map to the dashboard', () => {
    expect(collectDashboardParameters(dashboard?.widgets ?? []).map((p) => p.name)).toEqual([
      'days',
      'statuses',
    ])
  })

  it('leaves the widget-level parameter off the dashboard but still sends it', () => {
    const widget = dashboard?.widgets.find((w) => w.id === 50)
    if (!widget) throw new Error('the parameterised fixture widget is gone')

    expect(collectDashboardParameters([widget]).map((p) => p.name)).not.toContain('window')
    expect(widgetParameters(widget, { days: 30 })).toEqual({
      days: 30,
      window: 'd_last_30_days',
      statuses: ['Open'],
    })
  })
})
