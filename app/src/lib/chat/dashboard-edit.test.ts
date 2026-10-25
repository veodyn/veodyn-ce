import { describe, expect, it } from 'vitest'
import { ApiError } from '@/services/api-client'
import { CANNOT_EDIT_DASHBOARD, resolveDashboardEdit } from './dashboard-edit'
import { dashboard, request, resolve, signal, STAMP, text, transportFor } from './dashboard-edit.fixtures'
import { NOT_AVAILABLE } from './library-results'

describe('resolveDashboardEdit: reading and refusing', () => {
  it('refuses when the analyst cannot edit the dashboard', async () => {
    const result = await resolveDashboardEdit(
      request({ name: 'x' }),
      transportFor(dashboard({ can_edit: false })),
      signal
    )
    expect(result).toEqual({ kind: 'dashboard_edit', ok: false, error: CANNOT_EDIT_DASHBOARD })
    expect(CANNOT_EDIT_DASHBOARD).toBe('You cannot edit this dashboard.')
  })

  it('answers not available for a missing or archived dashboard', async () => {
    const gone = await resolveDashboardEdit(request({ name: 'x' }), transportFor(new ApiError(404, 'no')), signal)
    expect(gone).toEqual({ kind: 'dashboard_edit', ok: false, error: NOT_AVAILABLE })
    const archived = await resolveDashboardEdit(
      request({ name: 'x' }),
      transportFor(dashboard({ is_archived: true })),
      signal
    )
    expect(archived).toMatchObject({ ok: false, error: NOT_AVAILABLE })
  })

  it('returns the snapshot it read, including text widgets, and the dashboard id', async () => {
    const result = await resolve({ name: 'Operations' })
    expect(result).toMatchObject({
      ok: true,
      dashboardId: 4,
      name: 'Operations',
      problems: [],
      snapshot: {
        name: 'Ops',
        tags: ['ops'],
        version: 3,
        updatedAt: STAMP,
        widgets: [
          { widgetId: 1, kind: 'visualization', title: 'Query 1 · Chart 1', position: { col: 0, row: 0, sizeX: 3, sizeY: 8 }, updatedAt: 'U1' },
          { widgetId: 2, kind: 'text', title: '## Notes', position: { col: 3, row: 0, sizeX: 3, sizeY: 4 }, updatedAt: 'U2' },
        ],
      },
    })
  })

  it('leaves name and tags out when they already match', async () => {
    const result = await resolve({ name: 'Ops', tags: ['ops'], operations: [{ op: 'addText', text: 'hi' }] })
    expect(result.name).toBeUndefined()
    expect(result.tags).toBeUndefined()
    const reordered = await resolve({ tags: ['b', 'a'] }, transportFor(dashboard({ tags: ['a', 'b'] })))
    expect(reordered.tags).toBeUndefined()
    const changed = await resolve({ tags: ['ops', 'new'] })
    expect(changed.tags).toEqual(['ops', 'new'])
  })

  it('refuses a dashboard with more widgets than a snapshot carries', async () => {
    const widgets = Array.from({ length: 501 }, (_, index) => text(index + 1, 'x', { col: 0, row: index, sizeX: 1, sizeY: 1 }))
    const result = await resolveDashboardEdit(
      request({ name: 'x' }),
      transportFor(dashboard({ widgets })),
      signal
    )
    expect(result).toMatchObject({ ok: false })
  })
})
