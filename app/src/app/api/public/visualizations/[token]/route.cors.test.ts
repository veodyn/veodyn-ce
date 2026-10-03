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

const PARAMS = { params: Promise.resolve({ token: 'tok' }) }
const UPSTREAM = {
  type: 'CHART',
  name: 'Riders',
  description: '',
  options: {},
  query_result: { data: { columns: [], rows: [] } },
}

function request() {
  return new Request('http://localhost/api/public/visualizations/tok', { headers: { origin: 'https://host.example' } })
}

function expectOpenToAnyOrigin(response: Response) {
  expect(response.headers.get('access-control-allow-origin')).toBe('*')
  expect(response.headers.get('access-control-allow-credentials')).toBeNull()
}

describe('cross-origin reads of a shared visualization', () => {
  it('lets any origin read a served payload', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(UPSTREAM))
    const { GET } = await loadRoute('http://redash:5000')

    const response = await GET(request(), PARAMS)

    expect(response.status).toBe(200)
    expectOpenToAnyOrigin(response)
  })

  it('lets any origin read a refusal, so a host can tell a dead link from a blocked request', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 404 }))
    const { GET } = await loadRoute('http://redash:5000')

    const response = await GET(request(), PARAMS)

    expect(response.status).toBe(404)
    expectOpenToAnyOrigin(response)
  })

  it('lets any origin read an upstream outage', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'))
    const { GET } = await loadRoute('http://redash:5000')

    const response = await GET(request(), PARAMS)

    expect(response.status).toBe(502)
    expectOpenToAnyOrigin(response)
  })

  it('lets any origin read a missing configuration', async () => {
    const { GET } = await loadRoute()

    const response = await GET(request(), PARAMS)

    expect(response.status).toBe(503)
    expectOpenToAnyOrigin(response)
  })

  it('answers a preflight with the methods and header a host may use', async () => {
    const { OPTIONS } = await loadRoute('http://redash:5000')

    const response = OPTIONS()

    expect(response.status).toBe(204)
    expectOpenToAnyOrigin(response)
    expect(response.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS')
    expect(response.headers.get('access-control-allow-headers')).toBe('accept')
  })
})
