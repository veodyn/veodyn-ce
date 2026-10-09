import { describe, expect, it } from 'vitest'
import { normalizePublicVisualization } from './public-visualization'

const TABLE = { columns: [{ name: 'n', friendly_name: 'n', type: 'integer' }], rows: [{ n: 1 }] }

const UPSTREAM = {
  type: 'CHART',
  name: 'Riders',
  description: '',
  options: {},
  query_result: { data: TABLE, retrieved_at: '2026-10-08T10:00:00Z' },
  status: 'pending',
}

describe('normalizePublicVisualization status and retrievedAt', () => {
  it('reads both from the upstream shape', () => {
    const payload = normalizePublicVisualization(UPSTREAM)

    expect(payload?.status).toBe('pending')
    expect(payload?.retrievedAt).toBe('2026-10-08T10:00:00Z')
  })

  it('reads both from its own output', () => {
    const first = normalizePublicVisualization(UPSTREAM)

    expect(normalizePublicVisualization(first)).toEqual(first)
  })

  it.each(['fresh', 'pending', 'stale', 'unavailable'])('keeps status %s', (status) => {
    expect(normalizePublicVisualization({ ...UPSTREAM, status })?.status).toBe(status)
  })

  it('drops an invalid status', () => {
    const payload = normalizePublicVisualization({ ...UPSTREAM, status: 'bogus' })

    expect(payload).not.toBeNull()
    expect(payload).not.toHaveProperty('status')
  })

  it('carries a null retrieved_at as null', () => {
    const payload = normalizePublicVisualization({
      ...UPSTREAM,
      query_result: { data: TABLE, retrieved_at: null },
    })

    expect(payload?.retrievedAt).toBeNull()
  })

  it('omits both keys when the body has neither', () => {
    const payload = normalizePublicVisualization({ type: 'CHART', query_result: { data: TABLE } })

    expect(payload).not.toHaveProperty('status')
    expect(payload).not.toHaveProperty('retrievedAt')
  })

  it('keeps a status on a body with no result', () => {
    const payload = normalizePublicVisualization({ type: 'CHART', query_result: null, status: 'unavailable' })

    expect(payload?.data).toBeNull()
    expect(payload?.status).toBe('unavailable')
  })
})
