import { describe, expect, it } from 'vitest'
import { knownOutput, storedCall } from './thread-calls'
import { toolResultSchema } from './tool-results'

const OLD = {
  kind: 'dashboard',
  ok: true,
  dashboard: { id: 4, name: 'Ops', updatedAt: '2026-08-30T08:00:00Z' },
  widgets: [
    { title: 'Trips', queryId: 12, queryName: 'Trips', visualizationId: 31, visualizationType: 'CHART' },
    { title: 'Speed', queryId: 13, visualizationId: 32, visualizationType: 'COUNTER' },
  ],
  widgetCount: 2,
  textWidgets: 0,
}

describe('a dashboard result stored before widgets carried ids and positions', () => {
  it('restores as a finished card with synthetic, untargetable widget ids', () => {
    const call = storedCall('c1', 'open_dashboard', { dashboardId: 4 }, OLD)
    expect(call.status).toBe('done')
    const known = knownOutput(call)
    const output = known?.kind === 'dashboard' ? known : null
    expect(output?.widgets).toEqual([
      { ...OLD.widgets[0], widgetId: -1, kind: 'visualization', position: { col: 0, row: 0, sizeX: 3, sizeY: 8 } },
      { ...OLD.widgets[1], widgetId: -2, kind: 'visualization', position: { col: 0, row: 0, sizeX: 3, sizeY: 8 } },
    ])
  })

  it('keeps live results strict', () => {
    expect(toolResultSchema.safeParse(OLD).success).toBe(false)
  })

  it('leaves a current stored result as it was', () => {
    const current = {
      ...OLD,
      widgets: [{ widgetId: 9, kind: 'text', title: 'N', text: 'N', position: { col: 0, row: 0, sizeX: 6, sizeY: 4 } }],
    }
    const output = knownOutput(storedCall('c1', 'open_dashboard', {}, current))
    expect(output?.kind === 'dashboard' && output.widgets?.[0].widgetId).toBe(9)
  })
})
