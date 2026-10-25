import { afterEach, describe, expect, it, vi } from 'vitest'

async function loadRoute(redashUrl?: string) {
  vi.resetModules()
  if (redashUrl) process.env.REDASH_URL = redashUrl
  else delete process.env.REDASH_URL
  return import('./route')
}

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.REDASH_URL
})

function params(name = 'stop', widgetId = '5') {
  return { params: Promise.resolve({ token: 'dtok', widgetId, name }) }
}

function request(search = '') {
  return new Request(`http://localhost/api/public/dashboards/dtok/widgets/5/parameters/stop/values${search}`)
}

describe('GET /api/public/dashboards/[token]/widgets/[widgetId]/parameters/[name]/values', () => {
  it('forwards the prefix and serves the normalized list', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ values: [{ name: 'Central Station', value: '80214' }], truncated: true }))
    const { GET } = await loadRoute('https://redash.example')

    const response = await GET(request('?q=Union St'), params())

    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      'https://redash.example/api/dashboards/public/dtok/widgets/5/parameters/stop/values?q=Union%20St'
    )
    expect(await response.json()).toEqual({ values: [{ name: 'Central Station', value: '80214' }], truncated: true })
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
  })

  it.each([
    ['a malformed name', params('a-b')],
    ['a malformed widget id', params('stop', 'x')],
  ])('refuses %s without asking upstream', async (_label, ctx) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { GET } = await loadRoute('https://redash.example')

    expect((await GET(request(), ctx)).status).toBe(404)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('refuses an oversized prefix', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { GET } = await loadRoute('https://redash.example')

    expect((await GET(request(`?q=${'a'.repeat(201)}`), params())).status).toBe(404)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('passes an unavailable dropdown through as an empty 503 with its Retry-After', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ values: [], truncated: false }, { status: 503, headers: { 'Retry-After': '30' } })
    )
    const { GET } = await loadRoute('https://redash.example')

    const response = await GET(request(), params())

    expect(response.status).toBe(503)
    expect(response.headers.get('retry-after')).toBe('30')
    expect(await response.json()).toEqual({ values: [], truncated: false })
  })

  it('answers a plain 404 for a parameter that is not public', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ message: 'x' }, { status: 404 }))
    const { GET } = await loadRoute('https://redash.example')

    expect((await GET(request(), params())).status).toBe(404)
  })
})
