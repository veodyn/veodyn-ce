import { describe, expect, it, vi } from 'vitest'
import { createVisualization, deleteVisualization, updateVisualization } from './node-calls'
import type { RedashTransport } from './transport'

function transport() {
  return { get: vi.fn(), post: vi.fn(async () => ({ id: 1 })), del: vi.fn(async () => undefined) } as unknown as RedashTransport & {
    post: ReturnType<typeof vi.fn>
    del: ReturnType<typeof vi.fn>
  }
}

describe('visualization transport calls', () => {
  it('creates at visualizations with the body as given', async () => {
    const t = transport()
    await createVisualization(t, { query_id: 5, type: 'CHART', name: 'x', options: {}, idempotency_key: 'k' })
    expect(t.post).toHaveBeenCalledWith('visualizations', { query_id: 5, type: 'CHART', name: 'x', options: {}, idempotency_key: 'k' }, undefined)
  })

  it('updates with the precondition in the body, and without it when none is given', async () => {
    const t = transport()
    await updateVisualization(t, 11, { name: 'y' }, 'stamp')
    expect(t.post).toHaveBeenCalledWith('visualizations/11', { name: 'y', expected_updated_at: 'stamp' }, undefined)
    await updateVisualization(t, 11, { name: 'y' })
    expect(t.post).toHaveBeenLastCalledWith('visualizations/11', { name: 'y' }, undefined)
  })

  it('deletes with the precondition as a query parameter, and without it when none is given', async () => {
    const t = transport()
    await deleteVisualization(t, 11, 'stamp')
    expect(t.del).toHaveBeenCalledWith('visualizations/11', { expected_updated_at: 'stamp' }, undefined)
    await deleteVisualization(t, 11)
    expect(t.del).toHaveBeenLastCalledWith('visualizations/11', undefined, undefined)
  })
})
