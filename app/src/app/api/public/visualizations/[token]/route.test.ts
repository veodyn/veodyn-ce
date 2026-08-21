// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizePublicVisualization } from '@/lib/public-visualization'

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

// Transcribed field for field from `public_visualization` in
// node/redash/serializers/__init__.py, which is what
// PublicVisualizationResource returns. Every key upstream sends is here and no
// key it does not send is: notably there is NO `id`, because that serializer
// matches `public_widget` so an embed leaks no more than a shared dashboard,
// and node/tests/handlers/test_visualization_share.py asserts the omission.
// `query_result` is `serialize_query_result(..., is_api_user=True)`, which
// projects the result to `data` and `retrieved_at`.
//
// Change that Python function and this constant has to change with it. A
// fixture invented here instead would let the whole suite pass green against a
// response the backend never produces, which is exactly how the id requirement
// this file used to encode survived review.
const UPSTREAM_BODY = {
  type: 'CHART',
  name: 'Riders by station',
  description: 'Weekly total',
  options: { globalSeriesType: 'column' },
  updated_at: '2026-07-20T10:00:00Z',
  created_at: '2026-07-01T10:00:00Z',
  query: {
    id: 41,
    name: 'Riders',
    description: 'Weekly ridership',
    options: { parameters: [] },
  },
  query_result: {
    data: {
      columns: [{ name: 'station', friendly_name: 'Station', type: 'string' }],
      rows: [{ station: 'Central Station' }],
    },
    retrieved_at: '2026-07-20T09:59:00Z',
  },
}

const SERVED = {
  visualization: {
    type: 'CHART',
    name: 'Riders by station',
    description: 'Weekly total',
    options: { globalSeriesType: 'column' },
  },
  data: {
    columns: [{ name: 'station', friendly_name: 'Station', type: 'string' }],
    rows: [{ station: 'Central Station' }],
  },
}

function request(headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/public/visualizations/tok', { headers })
}

describe('GET /api/public/visualizations/[token]', () => {
  it('returns 503 when REDASH_URL is unset', async () => {
    const { GET } = await loadRoute()

    const response = await GET(request(), { params: Promise.resolve({ token: 'tok' }) })

    expect(response.status).toBe(503)
  })

  // The regression this file exists for. Redash sends no visualization id, so a
  // handler that requires one turns every live embed into a dead link while the
  // upstream call succeeds.
  it('serves the real no-id upstream body rather than refusing it', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json(UPSTREAM_BODY))
    const { GET } = await loadRoute('https://redash.example//')

    const response = await GET(request(), {
      params: Promise.resolve({ token: 'a token' }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      'https://redash.example/api/visualizations/public/a%20token'
    )
    expect(body).toEqual(SERVED)
  })

  it('passes on nothing about the query that produced the chart', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(UPSTREAM_BODY))
    const { GET } = await loadRoute('https://redash.example')

    const response = await GET(request(), { params: Promise.resolve({ token: 'tok' }) })
    const serialized = JSON.stringify(await response.json())

    // The query block upstream does send: its id names an object the reader
    // cannot open, and its name and description describe one.
    expect(serialized).not.toContain('41')
    expect(serialized).not.toContain('Riders"')
    expect(serialized).not.toContain('Weekly ridership')
    expect(serialized).not.toContain('retrieved_at')
  })

  // The client service normalizes a second time, on this handler's own output,
  // so that one function is the only description of the shape. That only holds
  // if a served body survives the round trip unchanged.
  it('serves a body its own normalizer accepts unchanged', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(UPSTREAM_BODY))
    const { GET } = await loadRoute('https://redash.example')

    const response = await GET(request(), { params: Promise.resolve({ token: 'tok' }) })
    const body = await response.json()

    expect(normalizePublicVisualization(body)).toEqual(body)
  })

  it('sends no cookie or authorization upstream and forwards the reader instead', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json(UPSTREAM_BODY))
    const { GET } = await loadRoute('https://redash.example')

    await GET(
      request({
        cookie: 'session=someone-elses-session',
        authorization: 'Key someone-elses-key',
        'x-forwarded-for': '203.0.113.7, 198.51.100.1',
        'user-agent': 'Mozilla/5.0 (reader)',
        referer: 'https://example.com/wiki/page',
      }),
      { params: Promise.resolve({ token: 'tok' }) }
    )

    const sent = fetchSpy.mock.calls[0]?.[1]?.headers as Record<string, string>
    expect(sent['x-forwarded-for']).toBe('203.0.113.7, 198.51.100.1')
    expect(sent['user-agent']).toBe('Mozilla/5.0 (reader)')
    expect(sent['referer']).toBe('https://example.com/wiki/page')
    expect(sent['cookie']).toBeUndefined()
    expect(sent['authorization']).toBeUndefined()
  })

  it.each([404, 401, 403, 500])(
    'answers a plain 404 for upstream %i without repeating its body',
    async (status) => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        Response.json({ message: 'Visualization 9 is not shared' }, { status })
      )
      const { GET } = await loadRoute('https://redash.example')

      const response = await GET(request(), { params: Promise.resolve({ token: 'tok' }) })
      const body = await response.json()

      expect(response.status).toBe(404)
      expect(JSON.stringify(body)).not.toContain('Visualization 9')
    }
  )

  // Each of these is the upstream body with one thing taken away, so the case
  // stays anchored to the real contract instead of describing a shape nobody
  // serves.
  it.each([
    ['a result that is not a table', { ...UPSTREAM_BODY, query_result: { data: {} } }],
    ['no visualization type', { ...UPSTREAM_BODY, type: undefined }],
    ['a bare string', 'gone'],
  ] as const)('answers 404 for a response with %s', async (_label, payload) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(payload))
    const { GET } = await loadRoute('https://redash.example')

    const response = await GET(request(), { params: Promise.resolve({ token: 'tok' }) })

    expect(response.status).toBe(404)
  })

  // A never-run query is NOT a dead link: whether the absence of a result is
  // fatal depends on the visualization type (a `needs: 'none'` wall panel
  // never waits for one), and the registry that answers that lives in the
  // client bundle. The route serves the payload with `data: null` and the
  // page decides. See src/lib/public-visualization.ts.
  it.each([
    ['a query that has never run', { ...UPSTREAM_BODY, query_result: null }],
    ['no result at all', { ...UPSTREAM_BODY, query_result: undefined }],
  ] as const)('serves the visualization with null data for %s', async (_label, payload) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(payload))
    const { GET } = await loadRoute('https://redash.example')

    const response = await GET(request(), { params: Promise.resolve({ token: 'tok' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toBeNull()
    expect(body.visualization.type).toBe(UPSTREAM_BODY.type)
  })

  // A refusal is decided on the status, before the body is parsed. An upstream
  // that answers HTML (a proxy error page, a Flask 500) would otherwise blow up
  // in JSON parsing and reach the reader as a 502, which says "we are broken"
  // about a link that is simply dead.
  it('answers 404 for a refusal whose body is not JSON at all', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html><body>502 Bad Gateway</body></html>', {
        status: 500,
        headers: { 'content-type': 'text/html' },
      })
    )
    const { GET } = await loadRoute('https://redash.example')

    const response = await GET(request(), { params: Promise.resolve({ token: 'tok' }) })

    expect(response.status).toBe(404)
    expect(await response.text()).not.toContain('Bad Gateway')
  })

  it('answers 502 when the backend cannot be reached', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))
    const { GET } = await loadRoute('https://redash.example')

    const response = await GET(request(), { params: Promise.resolve({ token: 'tok' }) })

    expect(response.status).toBe(502)
  })

  it('never echoes the token back to the reader', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ message: 'not found' }, { status: 404 })
    )
    const { GET } = await loadRoute('https://redash.example')

    const response = await GET(request(), {
      params: Promise.resolve({ token: 'sup3r-s3cret-token' }),
    })

    expect(await response.text()).not.toContain('sup3r-s3cret-token')
  })
})
