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
  name: 'Bridge closure',
  layout: [],
  dashboard_filters_enabled: false,
  updated_at: '2026-10-12T10:00:00Z',
  created_at: '2026-10-01T10:00:00Z',
  options: {},
  widgets: [
    {
      id: 5,
      width: 1,
      options: { position: { col: 0, row: 0, sizeX: 6, sizeY: 8 } },
      text: '',
      updated_at: '2026-10-12T10:00:00Z',
      created_at: '2026-10-01T10:00:00Z',
      visualization: {
        type: 'TABLE',
        name: 'Detour segments',
        description: '',
        options: {},
        updated_at: '2026-10-12T10:00:00Z',
        created_at: '2026-10-01T10:00:00Z',
        query: { id: 314, name: 'vtb_detour_segments', description: 'internal note', options: { parameters: [] } },
      },
    },
  ],
}

const PARAMS = { params: Promise.resolve({ token: 'dash tok' }) }

function request(headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/public/dashboards/tok', { headers })
}

describe('GET /api/public/dashboards/[token]', () => {
  it('returns 503 when REDASH_URL is unset', async () => {
    const { GET } = await loadRoute()

    expect((await GET(request(), PARAMS)).status).toBe(503)
  })

  it('serves the normalized layout from the public dashboard endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(UPSTREAM_BODY))
    const { GET } = await loadRoute('https://redash.example/')

    const response = await GET(request(), PARAMS)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://redash.example/api/dashboards/public/dash%20tok')
    expect(body.widgets).toEqual([
      {
        id: 5,
        position: { col: 0, row: 0, sizeX: 6, sizeY: 8 },
        hideTitle: false,
        text: null,
        visualization: { type: 'TABLE', name: 'Detour segments', description: '', options: {} },
        parameters: [],
      },
    ])
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('passes on nothing about the queries behind the widgets', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(UPSTREAM_BODY))
    const { GET } = await loadRoute('https://redash.example')

    const text = await (await GET(request(), PARAMS)).text()

    expect(text).not.toContain('314')
    expect(text).not.toContain('vtb_detour_segments')
    expect(text).not.toContain('internal note')
  })

  it('sends no cookie or authorization upstream', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(UPSTREAM_BODY))
    const { GET } = await loadRoute('https://redash.example')

    await GET(request({ cookie: 'session=abc', authorization: 'Key k' }), PARAMS)

    const sent = fetchSpy.mock.calls[0]?.[1]?.headers as Record<string, string>
    expect(sent.cookie).toBeUndefined()
    expect(sent.authorization).toBeUndefined()
  })

  it.each([404, 401, 403])('answers a plain 404 for upstream %i', async (status) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ message: 'Dashboard 9' }, { status }))
    const { GET } = await loadRoute('https://redash.example')

    const response = await GET(request(), PARAMS)

    expect(response.status).toBe(404)
    expect(await response.text()).not.toContain('Dashboard 9')
  })

  it('answers 404 for a body that is not a dashboard', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ name: 'x' }))
    const { GET } = await loadRoute('https://redash.example')

    expect((await GET(request(), PARAMS)).status).toBe(404)
  })

  it.each([500, 429])('answers upstream %i as an outage', async (status) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('down', { status }))
    const { GET } = await loadRoute('https://redash.example')

    expect((await GET(request(), PARAMS)).status).toBe(502)
  })

  it('answers 502 when the backend cannot be reached', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))
    const { GET } = await loadRoute('https://redash.example')

    expect((await GET(request(), PARAMS)).status).toBe(502)
  })
})
