import { describe, expect, it } from 'vitest'
import { publicVisualizationUrl, fetchPublicVisualization } from './fetch-public-visualization'
import { canonicalParameters, parseRetryAfterMs, pollIntervalMs } from './public-request'

describe('canonicalParameters', () => {
  it('sorts by key and stringifies values', () => {
    expect(canonicalParameters({ route: 'MT020', a: 2 })).toEqual([
      ['a', '2'],
      ['route', 'MT020'],
    ])
  })

  it('is empty without parameters', () => {
    expect(canonicalParameters(undefined)).toEqual([])
    expect(canonicalParameters({})).toEqual([])
  })
})

describe('publicVisualizationUrl', () => {
  it('is unchanged without parameters', () => {
    expect(publicVisualizationUrl('https://v.test//', 'a b')).toBe('https://v.test/api/public/visualizations/a%20b')
  })

  it('appends p_ keys sorted by key with encoded values', () => {
    expect(publicVisualizationUrl('https://v.test', 'tok', { route: 'MT 020', a: 1 })).toBe(
      'https://v.test/api/public/visualizations/tok?p_a=1&p_route=MT%20020'
    )
  })
})

describe('publicVisualizationUrl names', () => {
  it.each([
    ['route=MT020&ignored', 'p_route%3DMT020%26ignored=1'],
    ['a#b', 'p_a%23b=1'],
    ['a&b', 'p_a%26b=1'],
  ])('encodes the name %s', (name, pair) => {
    expect(publicVisualizationUrl('https://v.test', 'tok', { [name]: 1 })).toBe(
      `https://v.test/api/public/visualizations/tok?${pair}`
    )
  })
})

describe('parseRetryAfterMs', () => {
  it.each([
    ['2', 2000],
    ['0', 1000],
    ['120', 30000],
    ['1.5', 1500],
  ])('reads %s seconds as %i ms clamped', (header, expected) => {
    expect(parseRetryAfterMs(header)).toBe(expected)
  })

  it.each([null, '', 'soon'])('is undefined for %s', (header) => {
    expect(parseRetryAfterMs(header)).toBeUndefined()
  })
})

describe('pollIntervalMs', () => {
  const pending = { status: 'pending' as const, retryAfterMs: 2000 }

  it('retries after Retry-After for the first 10 pending answers', () => {
    expect(pollIntervalMs(pending, 1, null)).toBe(2000)
    expect(pollIntervalMs(pending, 10, null)).toBe(2000)
  })

  it('falls back to 30 seconds after 10 retries', () => {
    expect(pollIntervalMs(pending, 11, null)).toBe(30_000)
  })

  it('falls back to the larger of refresh and 30 seconds', () => {
    expect(pollIntervalMs(pending, 11, 60_000)).toBe(60_000)
    expect(pollIntervalMs({ status: 'unavailable' }, 11, 15_000)).toBe(30_000)
  })

  it('uses 2 seconds when pending carried no Retry-After', () => {
    expect(pollIntervalMs({ status: 'pending' }, 1, null)).toBe(2000)
  })

  it('uses the refresh cadence for anything else', () => {
    expect(pollIntervalMs({ status: 'fresh' }, 0, 20_000)).toBe(20_000)
    expect(pollIntervalMs({ status: 'stale' }, 0, null)).toBe(false)
    expect(pollIntervalMs(null, 0, null)).toBe(false)
    expect(pollIntervalMs(undefined, 0, 20_000)).toBe(20_000)
  })
})

describe('fetchPublicVisualization', () => {
  const body = {
    visualization: { type: 'CHART', name: 'n', description: '', options: {} },
    data: null,
  }

  function respond(status: number, headers: Record<string, string> = {}, json: unknown = body) {
    return () => Promise.resolve(new Response(JSON.stringify(json), { status, headers }))
  }

  it.each([
    [202, 'pending', '3', 3000],
    [503, 'unavailable', '99', 30000],
  ])('returns the %i payload with retryAfterMs', async (status, state, header, expected) => {
    globalThis.fetch = respond(status, { 'Retry-After': header }, { ...body, status: state }) as typeof fetch

    const result = await fetchPublicVisualization('https://v.test', 'tok', { route: 'x' })

    expect(result?.status).toBe(state)
    expect(result?.retryAfterMs).toBe(expected)
  })

  it('returns no retryAfterMs on a 200', async () => {
    globalThis.fetch = respond(200, { 'Retry-After': '3' }) as typeof fetch

    expect(await fetchPublicVisualization('https://v.test', 'tok')).not.toHaveProperty('retryAfterMs')
  })

  it('still throws for a 503 that is not a payload and null for 404', async () => {
    globalThis.fetch = respond(503, {}, { error: 'x' }) as typeof fetch
    await expect(fetchPublicVisualization('https://v.test', 'tok')).rejects.toThrow()

    globalThis.fetch = respond(404) as typeof fetch
    expect(await fetchPublicVisualization('https://v.test', 'tok')).toBeNull()
  })
})
