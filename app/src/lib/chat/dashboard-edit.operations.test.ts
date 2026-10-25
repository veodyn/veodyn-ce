import { describe, expect, it } from 'vitest'
import { ApiError } from '@/services/api-client'
import { dashboard, overlaps, query, resolve, text, transportFor } from './dashboard-edit.fixtures'

describe('resolveDashboardEdit: operations on existing widgets', () => {
  it('resolves editText, move and remove with the target title, timestamp and position', async () => {
    const result = await resolve({
      operations: [
        { op: 'editText', widgetId: 2, text: 'new body' },
        { op: 'move', widgetId: 1, position: { col: 3, row: 4, sizeX: 3, sizeY: 6 } },
      ],
    })
    expect(result.problems).toEqual([])
    expect(result.operations).toEqual([
      {
        op: 'editText',
        widgetId: 2,
        text: 'new body',
        title: '## Notes',
        updatedAt: 'U2',
        position: { col: 3, row: 0, sizeX: 3, sizeY: 4 },
      },
      {
        op: 'move',
        widgetId: 1,
        title: 'Query 1 · Chart 1',
        updatedAt: 'U1',
        position: { col: 3, row: 4, sizeX: 3, sizeY: 6 },
      },
    ])
    const removed = await resolve({ operations: [{ op: 'remove', widgetId: 1 }] })
    expect(removed.operations).toEqual([
      { op: 'remove', widgetId: 1, title: 'Query 1 · Chart 1', updatedAt: 'U1', position: { col: 0, row: 0, sizeX: 3, sizeY: 8 } },
    ])
  })

  it('reports an unknown widget id and editText on a chart as problems', async () => {
    const result = await resolve({
      operations: [
        { op: 'remove', widgetId: 99 },
        { op: 'editText', widgetId: 1, text: 'x' },
      ],
    })
    expect(result.operations).toEqual([])
    expect(result.problems).toEqual([
      'Operation 1: widget 99 is not on this dashboard.',
      'Operation 2: widget 1 is a chart, not a text box, so its text cannot be edited.',
    ])
    expect(result.dashboardId).toBe(4)
  })

  it('checks widget ids against every widget, not the fifty chat lists', async () => {
    const widgets = Array.from({ length: 60 }, (_, index) =>
      text(index + 1, 'x', { col: 0, row: index, sizeX: 1, sizeY: 1 })
    )
    const result = await resolve(
      { operations: [{ op: 'remove', widgetId: 58 }] },
      transportFor(dashboard({ widgets }))
    )
    expect(result.problems).toEqual([])
    expect(result.operations).toHaveLength(1)
  })

  it('reports a target widget that has no last-edit time', async () => {
    const result = await resolve(
      { operations: [{ op: 'remove', widgetId: 2 }] },
      transportFor(dashboard({ widgets: [text(2, 'x', { col: 0, row: 0, sizeX: 2, sizeY: 2 }, { updated_at: '' })] }))
    )
    expect(result.problems).toEqual(['Operation 1: widget 2 has no last-edit time to protect, so chat will not change it.'])
  })

  it('clamps a legacy position into the grid for operations that do not place the widget', async () => {
    const odd = text(2, 'x', { col: 4, row: 0, sizeX: 5, sizeY: 90 })
    const result = await resolve(
      { operations: [{ op: 'remove', widgetId: 2 }] },
      transportFor(dashboard({ widgets: [odd] }))
    )
    expect(result.operations?.[0].position).toEqual({ col: 4, row: 0, sizeX: 2, sizeY: 40 })
  })
})

describe('resolveDashboardEdit: adding widgets', () => {
  it('checks the query and visualization and names the widget like the dashboard does', async () => {
    const result = await resolve({ operations: [{ op: 'add', queryId: 7, visualizationId: 70 }] })
    expect(result.problems).toEqual([])
    expect(result.operations).toEqual([
      { op: 'add', queryId: 7, visualizationId: 70, title: 'Trips 7 · Line', position: expect.any(Object) },
    ])
  })

  it('reports an unreadable query and a visualization the query does not have', async () => {
    const result = await resolve({
      operations: [
        { op: 'add', queryId: 8, visualizationId: 80 },
        { op: 'add', queryId: 7, visualizationId: 999 },
        { op: 'add', queryId: 9, visualizationId: 90 },
      ],
    }, transportFor(dashboard(), { 7: query(7), 8: new ApiError(403, 'no'), 9: query(9, { is_archived: true }) }))
    expect(result.problems).toEqual([
      'Operation 1: query 8 is not available to the analyst.',
      'Operation 2: query 7 has no visualization 999.',
      'Operation 3: query 9 is not available to the analyst.',
    ])
  })

  it('passes a query draft through without reading a query', async () => {
    const transport = transportFor(dashboard())
    const result = await resolve({ operations: [{ op: 'add', queryDraftId: 'd-1' }] }, transport)
    expect(result.operations).toEqual([
      { op: 'add', queryDraftId: 'd-1', title: expect.any(String), position: expect.any(Object) },
    ])
    expect(transport.get).toHaveBeenCalledTimes(1)
  })

  it('places widgets without a position with the add-widget dialog helpers, text at 6 by 4', async () => {
    const result = await resolve({
      operations: [
        { op: 'add', queryId: 7, visualizationId: 70 },
        { op: 'add', queryId: 7, visualizationId: 71 },
        { op: 'addText', text: 'Footer' },
      ],
    })
    const positions = (result.operations ?? []).map((one) => one.position)
    expect(positions).toEqual([
      { col: 3, row: 4, sizeX: 3, sizeY: 6 },
      { col: 0, row: 8, sizeX: 2, sizeY: 5 },
      { col: 0, row: 13, sizeX: 6, sizeY: 4 },
    ])
  })

  it('never overlaps the existing layout or its own earlier placements', async () => {
    const result = await resolve({
      operations: [
        { op: 'add', queryId: 7, visualizationId: 70 },
        { op: 'add', queryId: 7, visualizationId: 70 },
        { op: 'add', queryId: 7, visualizationId: 71 },
        { op: 'addText', text: 'a' },
        { op: 'addText', text: 'b' },
        { op: 'add', queryId: 7, visualizationId: 70 },
      ],
    })
    expect(result.problems).toEqual([])
    const placed = (result.operations ?? []).map((one) => one.position)
    const existing = [
      { col: 0, row: 0, sizeX: 3, sizeY: 8 },
      { col: 3, row: 0, sizeX: 3, sizeY: 4 },
    ]
    placed.forEach((one, index) => {
      for (const other of existing) expect(overlaps(one, other)).toBe(false)
      for (const later of placed.slice(index + 1)) expect(overlaps(one, later)).toBe(false)
    })
  })

  it('treats a widget moved or removed earlier in the same edit as already gone from its old spot', async () => {
    const result = await resolve({
      operations: [
        { op: 'remove', widgetId: 1 },
        { op: 'add', queryId: 7, visualizationId: 70 },
      ],
    })
    expect(result.operations?.[1].position).toEqual({ col: 0, row: 0, sizeX: 3, sizeY: 6 })
    const moved = await resolve({
      operations: [
        { op: 'move', widgetId: 1, position: { col: 0, row: 20, sizeX: 3, sizeY: 8 } },
        { op: 'add', queryId: 7, visualizationId: 70 },
      ],
    })
    expect(moved.operations?.[1].position).toEqual({ col: 0, row: 0, sizeX: 3, sizeY: 6 })
  })

  it('keeps a position the model gave', async () => {
    const position = { col: 2, row: 30, sizeX: 4, sizeY: 5 }
    const result = await resolve({ operations: [{ op: 'addText', text: 'x', position }] })
    expect(result.operations?.[0].position).toEqual(position)
  })
})
