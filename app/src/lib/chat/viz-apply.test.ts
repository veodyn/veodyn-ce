import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/services/api-client'
import type { VizDraft } from './viz-apply'
import { applyVizChange, CHANGED_SINCE_READ } from './viz-apply'
import type { VizPayload } from './viz-changes'
import type { RedashTransport } from './transport'

const chat = vi.hoisted(() => ({ recordPromotion: vi.fn(), patchPromotion: vi.fn() }))
vi.mock('@/services/ai/chat-client', () => chat)

const STAMP = '2026-10-24T10:01:00.456Z'
const SAVED = '2026-10-24T10:09:00.000Z'
const PENDING = { id: 'p1', status: 'pending', receipts: [], targetId: '5' }

function draftOf(payload: VizPayload): VizDraft {
  return { id: 'd1', versions: [{ version: 2, payload }], promotions: [] }
}

const NEW: VizPayload = { mode: 'new', queryId: 5, next: { type: 'PIVOT', name: 'Pivot', options: { rowField: 'day' } } }
const EDIT: VizPayload = {
  mode: 'edit',
  queryId: 5,
  visualizationId: 11,
  snapshot: { type: 'CHART', name: 'Bars', options: { a: 1 }, updatedAt: STAMP },
  next: { type: 'CHART', name: 'Bars', options: { a: 2 } },
}
const DELETE: VizPayload = {
  mode: 'delete',
  queryId: 5,
  visualizationId: 11,
  snapshot: { type: 'CHART', name: 'Bars', options: { a: 1 }, updatedAt: STAMP },
}

function transportOf(post: unknown = { id: 11, updated_at: SAVED }, del: unknown = undefined) {
  const failOn = (value: unknown) => async () => {
    if (value instanceof Error) throw value
    return value
  }
  return { get: vi.fn(), post: vi.fn(failOn(post)), del: vi.fn(failOn(del)) } as unknown as RedashTransport & {
    post: ReturnType<typeof vi.fn>
    del: ReturnType<typeof vi.fn>
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  chat.recordPromotion.mockResolvedValue(PENDING)
  chat.patchPromotion.mockImplementation(async (_d: string, _p: string, patch: object) => ({ ...PENDING, ...patch }))
})

describe('applyVizChange', () => {
  it('records the pending promotion against the query before writing', async () => {
    const transport = transportOf()
    await applyVizChange(draftOf(NEW), 2, transport, { overwrite: false })
    expect(chat.recordPromotion).toHaveBeenCalledWith('d1', {
      version: 2,
      targetType: 'query',
      targetId: '5',
      status: 'pending',
    })
  })

  it('creates a new visualization with the idempotency key and records the visualization as the receipt', async () => {
    const transport = transportOf({ id: 31, updated_at: SAVED })
    const outcome = await applyVizChange(draftOf(NEW), 2, transport, { overwrite: false })
    expect(transport.post.mock.calls[0].slice(0, 2)).toEqual([
      'visualizations',
      { query_id: 5, type: 'PIVOT', name: 'Pivot', options: { rowField: 'day' }, idempotency_key: 'd1:2:0' },
    ])
    expect(chat.patchPromotion).toHaveBeenCalledWith('d1', 'p1', {
      status: 'done',
      targetId: '5',
      receipts: [{ step: 0, outcome: 'done', targetId: '31', updatedAt: SAVED }],
    })
    expect(outcome.status).toBe('done')
  })

  it('edits with the full next options and the snapshot stamp as the precondition', async () => {
    const transport = transportOf()
    await applyVizChange(draftOf(EDIT), 2, transport, { overwrite: false })
    expect(transport.post.mock.calls[0].slice(0, 2)).toEqual([
      'visualizations/11',
      { type: 'CHART', name: 'Bars', options: { a: 2 }, expected_updated_at: STAMP },
    ])
  })

  it('overwrite drops the precondition', async () => {
    const transport = transportOf()
    await applyVizChange(draftOf(EDIT), 2, transport, { overwrite: true })
    expect(transport.post.mock.calls[0][1]).not.toHaveProperty('expected_updated_at')
  })

  it('deletes with the precondition as a query parameter', async () => {
    const transport = transportOf()
    const outcome = await applyVizChange(draftOf(DELETE), 2, transport, { overwrite: false })
    expect(transport.del.mock.calls[0].slice(0, 2)).toEqual(['visualizations/11', { expected_updated_at: STAMP }])
    expect(outcome.status).toBe('done')
  })

  it('reports a 409 as a conflict and records the failure', async () => {
    const transport = transportOf(new ApiError(409, 'stale'))
    const outcome = await applyVizChange(draftOf(EDIT), 2, transport, { overwrite: false })
    expect(outcome).toEqual({ status: 'conflict' })
    expect(chat.patchPromotion).toHaveBeenCalledWith(
      'd1',
      'p1',
      expect.objectContaining({ status: 'failed', receipts: [expect.objectContaining({ outcome: 'failed', error: CHANGED_SINCE_READ })] })
    )
  })

  it('reports another failure with its message', async () => {
    const transport = transportOf(new ApiError(403, 'Forbidden'))
    const outcome = await applyVizChange(draftOf(EDIT), 2, transport, { overwrite: false })
    expect(outcome.status).toBe('failed')
  })

  it('returns unsynced when the done patch cannot be saved', async () => {
    chat.patchPromotion.mockRejectedValueOnce(new Error('down'))
    const outcome = await applyVizChange(draftOf(EDIT), 2, transportOf(), { overwrite: false })
    expect(outcome.status).toBe('unsynced')
  })

  it('fails for a version the draft does not hold', async () => {
    const outcome = await applyVizChange(draftOf(EDIT), 9, transportOf(), { overwrite: false })
    expect(outcome.status).toBe('failed')
  })
})
