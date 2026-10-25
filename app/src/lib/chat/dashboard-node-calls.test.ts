import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/services/api-client'
import { createWidget, deleteWidget, getRawDashboard, updateDashboard, updateWidget } from './dashboard-node-calls'
import type { RedashTransport } from './transport'

function transport() {
  return {
    get: vi.fn(async () => ({ id: 3 })),
    post: vi.fn(async () => ({ id: 1 })),
    del: vi.fn(async () => undefined),
  } as unknown as RedashTransport & {
    get: ReturnType<typeof vi.fn>
    post: ReturnType<typeof vi.fn>
    del: ReturnType<typeof vi.fn>
  }
}

const POSITION = { col: 0, row: 0, sizeX: 3, sizeY: 8 }

describe('dashboard transport calls', () => {
  it('creates a chart widget with visible options, an unpinned height and the idempotency key', async () => {
    const t = transport()
    await createWidget(t, { dashboard_id: 3, visualization_id: 9, options: { position: POSITION }, idempotency_key: 'k' })
    expect(t.post).toHaveBeenCalledWith(
      'widgets',
      {
        dashboard_id: 3,
        visualization_id: 9,
        text: '',
        width: 1,
        options: { isHidden: false, position: { autoHeight: false, ...POSITION } },
        idempotency_key: 'k',
      },
      undefined
    )
  })

  it('creates a text widget with a null visualization and its text', async () => {
    const t = transport()
    await createWidget(t, { dashboard_id: 3, visualization_id: null, text: 'hi', options: { position: POSITION } })
    expect(t.post).toHaveBeenCalledWith(
      'widgets',
      expect.objectContaining({ visualization_id: null, text: 'hi' }),
      undefined
    )
  })

  it('updates a widget with the precondition in the body, and without it when none is given', async () => {
    const t = transport()
    const body = { text: 'a', width: 1, options: { position: POSITION, extra: 1 } }
    await updateWidget(t, 8, body, 'stamp')
    expect(t.post).toHaveBeenCalledWith('widgets/8', { ...body, expected_updated_at: 'stamp' }, undefined)
    await updateWidget(t, 8, body)
    expect(t.post).toHaveBeenLastCalledWith('widgets/8', body, undefined)
  })

  it('deletes a widget with the precondition as a query parameter, and without it when none is given', async () => {
    const t = transport()
    await deleteWidget(t, 8, 'stamp')
    expect(t.del).toHaveBeenCalledWith('widgets/8', { expected_updated_at: 'stamp' }, undefined)
    await deleteWidget(t, 8)
    expect(t.del).toHaveBeenLastCalledWith('widgets/8', undefined, undefined)
  })

  it('updates a dashboard with only the changed fields and the precondition', async () => {
    const t = transport()
    await updateDashboard(t, 3, { name: 'New' }, 'stamp')
    expect(t.post).toHaveBeenCalledWith('dashboards/3', { name: 'New', expected_updated_at: 'stamp' }, undefined)
    await updateDashboard(t, 3, { tags: ['a'] })
    expect(t.post).toHaveBeenLastCalledWith('dashboards/3', { tags: ['a'] }, undefined)
  })

  it('reads the raw dashboard, null when it is gone', async () => {
    const t = transport()
    expect(await getRawDashboard(t, 3)).toEqual({ id: 3 })
    t.get.mockRejectedValueOnce(new ApiError(404, 'gone'))
    expect(await getRawDashboard(t, 3)).toBeNull()
  })
})
