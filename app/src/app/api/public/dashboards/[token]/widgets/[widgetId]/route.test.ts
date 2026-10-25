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

const UPSTREAM_BODY = {
  type: 'TABLE',
  name: 'Departures',
  description: '',
  options: {},
  updated_at: '2026-10-12T10:00:00Z',
  created_at: '2026-10-01T10:00:00Z',
  query: { id: 85, name: 'Departures by stop', description: '', options: { parameters: [] } },
  query_result: { data: { columns: [{ name: 'stop', friendly_name: 'Stop', type: 'string' }], rows: [{ stop: 'A' }] }, retrieved_at: '2026-10-12T09:59:00Z' },
}

function params(widgetId: string) {
  return { params: Promise.resolve({ token: 'dtok', widgetId }) }
}

function request(search = '') {
  return new Request(`http://localhost/api/public/dashboards/dtok/widgets/5${search}`)
}

describe('GET /api/public/dashboards/[token]/widgets/[widgetId]', () => {
  it('forwards to the dashboard widget endpoint and normalizes like a shared visualization', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(UPSTREAM_BODY))
    const { GET } = await loadRoute('https://redash.example')

    const response = await GET(request(), params('5'))
    const body = await response.json()

    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://redash.example/api/dashboards/public/dtok/widgets/5')
    expect(response.status).toBe(200)
    expect(body.data.rows).toEqual([{ stop: 'A' }])
    expect(JSON.stringify(body)).not.toContain('Departures by stop')
  })

  it('carries public parameters through in canonical order', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(UPSTREAM_BODY))
    const { GET } = await loadRoute('https://redash.example')

    await GET(request('?p_stop=80214&p_agency=metro&other=x'), params('5'))

    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      'https://redash.example/api/dashboards/public/dtok/widgets/5?p_agency=metro&p_stop=80214'
    )
  })

  it('passes a pending answer through with its Retry-After', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ ...UPSTREAM_BODY, status: 'pending', query_result: null }, { status: 202, headers: { 'Retry-After': '2' } })
    )
    const { GET } = await loadRoute('https://redash.example')

    const response = await GET(request('?p_stop=1'), params('5'))

    expect(response.status).toBe(202)
    expect(response.headers.get('retry-after')).toBe('2')
  })

  it.each(['0', '-1', 'abc', '5.0', '1e3'])('refuses widget id %s without asking upstream', async (widgetId) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { GET } = await loadRoute('https://redash.example')

    expect((await GET(request(), params(widgetId))).status).toBe(404)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('answers a plain 404 for an upstream refusal', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ message: 'nope' }, { status: 404 }))
    const { GET } = await loadRoute('https://redash.example')

    expect((await GET(request(), params('5'))).status).toBe(404)
  })
})
