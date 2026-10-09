import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchPublicVisualization } from './visualizations'

const BODY = {
  visualization: { type: 'CHART', name: 'n', description: '', options: {} },
  data: null,
}

function respond(status: number, headers: Record<string, string> = {}, json: unknown = BODY) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(json), { status, headers }))
}

afterEach(() => vi.restoreAllMocks())

describe('fetchPublicVisualization', () => {
  it('requests the bare route without parameters', async () => {
    const spy = respond(200)

    await fetchPublicVisualization('a b')

    expect(spy.mock.calls[0]?.[0]).toBe('/api/public/visualizations/a%20b')
  })

  it('appends p_ keys sorted by key', async () => {
    const spy = respond(200)

    await fetchPublicVisualization('tok', { parameters: { route: 'MT 020', a: 1 } })

    expect(spy.mock.calls[0]?.[0]).toBe('/api/public/visualizations/tok?p_a=1&p_route=MT%20020')
  })

  it.each([
    [202, 'pending', '5', 5000],
    [503, 'unavailable', '0', 1000],
    [503, 'unavailable', '90', 30000],
  ])('returns a %i payload with retryAfterMs', async (status, state, header, expected) => {
    respond(status, { 'Retry-After': header }, { ...BODY, status: state })

    const result = await fetchPublicVisualization('tok', { parameters: { route: 'x' } })

    expect(result?.status).toBe(state)
    expect(result?.retryAfterMs).toBe(expected)
  })

  it('returns null for a refusal and for a body that is not a visualization', async () => {
    respond(404)
    expect(await fetchPublicVisualization('tok')).toBeNull()

    respond(502)
    expect(await fetchPublicVisualization('tok')).toBeNull()

    respond(503, {}, { error: 'x' })
    expect(await fetchPublicVisualization('tok')).toBeNull()
  })
})
