// @vitest-environment node
//
// The proxy in front of the sidecar's tag endpoints. Four things matter here
// and nowhere else: the upstream is resolved from any of veodyn-api's three
// env aliases (prod sets only CATALOG_API_URL, so reading KPI_API_URL alone
// leaves this route dead there), the bare /api/tags vocabulary and the
// /api/tags/{type}/{id} write are served by one handler, the browser's
// credential has to reach the backend so it can enforce per-org permissions,
// and the path segments are caller input that must not be forwarded blind.
import { afterEach, describe, expect, it, vi } from 'vitest'

const BASE_VARS = ['KPI_API_URL', 'CATALOG_API_URL', 'REPORTS_API_URL'] as const

type BaseVar = (typeof BASE_VARS)[number]

async function loadRoute(vars: Partial<Record<BaseVar, string>> = {}) {
  vi.resetModules()
  for (const name of BASE_VARS) {
    const value = vars[name]
    if (value) process.env[name] = value
    else delete process.env[name]
  }
  return import('./route')
}

function ctx(path?: string[]) {
  return { params: Promise.resolve({ path }) }
}

function ok(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const name of BASE_VARS) delete process.env[name]
})

describe('/api/tags upstream resolution', () => {
  // veodyn-api serves /kpis, /catalog, /reports and /tags off one root, and the
  // three vars are aliases for that root rather than three services. Each
  // deployment happens to set a different subset: dev sets all three, prod sets
  // only CATALOG_API_URL. So each alone has to be enough.
  it.each(BASE_VARS)('resolves the upstream from %s alone', async (name) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok([{ name: 'rail', count: 2 }]))
    const { GET } = await loadRoute({ [name]: 'http://veodyn-api:8000' })
    const res = await GET(new Request('http://localhost/api/tags'), ctx(undefined))

    expect(res.status).toBe(200)
    expect(fetchSpy.mock.calls[0][0]).toBe('http://veodyn-api:8000/tags')
  })

  it.each(BASE_VARS)('resolves a write upstream from %s alone', async (name) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok({ tags: ['rail'] }))
    const { PUT } = await loadRoute({ [name]: 'http://veodyn-api:8000' })
    const res = await PUT(
      new Request('http://localhost/api/tags/kpi/k-1', { method: 'PUT', body: '{"tags":["rail"]}' }),
      ctx(['kpi', 'k-1'])
    )

    expect(res.status).toBe(200)
    expect(fetchSpy.mock.calls[0][0]).toBe('http://veodyn-api:8000/tags/kpi/k-1')
  })

  // Deterministic rather than arbitrary, so a machine with all three set does
  // not talk to a different host between two requests.
  it('prefers KPI_API_URL when more than one alias is set', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok([]))
    const { GET } = await loadRoute({
      KPI_API_URL: 'http://kpi.test',
      CATALOG_API_URL: 'http://catalog.test',
      REPORTS_API_URL: 'http://reports.test',
    })
    await GET(new Request('http://localhost/api/tags'), ctx(undefined))

    expect(fetchSpy.mock.calls[0][0]).toBe('http://kpi.test/tags')
  })

  it('503s the vocabulary read when none of the three is set', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok([]))
    const { GET } = await loadRoute({})
    const res = await GET(new Request('http://localhost/api/tags'), ctx(undefined))

    expect(res.status).toBe(503)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  // The editing affordance is hidden on a 503, so the write path has to answer
  // the same way rather than 404ing or 500ing.
  it('503s a write when none of the three is set', async () => {
    const { PUT } = await loadRoute({})
    const res = await PUT(
      new Request('http://localhost/api/tags/kpi/k-1', { method: 'PUT', body: '{"tags":[]}' }),
      ctx(['kpi', 'k-1'])
    )
    expect(res.status).toBe(503)
  })
})

describe('/api/tags proxy', () => {
  it('sends the bare vocabulary read to /tags with no trailing segment', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok([{ name: 'rail', count: 2 }]))
    const { GET } = await loadRoute({ KPI_API_URL: 'http://backend.test/' })
    const res = await GET(new Request('http://localhost/api/tags'), ctx(undefined))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ name: 'rail', count: 2 }])
    expect(fetchSpy.mock.calls[0][0]).toBe('http://backend.test/tags')
  })

  it('forwards a write to /tags/{type}/{id} with the method and body intact', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok({ tags: ['rail'] }))
    const { PUT } = await loadRoute({ KPI_API_URL: 'http://backend.test' })
    const res = await PUT(
      new Request('http://localhost/api/tags/kpi/k-1', {
        method: 'PUT',
        body: JSON.stringify({ tags: ['rail'] }),
      }),
      ctx(['kpi', 'k-1'])
    )

    expect(res.status).toBe(200)
    expect(fetchSpy.mock.calls[0][0]).toBe('http://backend.test/tags/kpi/k-1')
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({
      method: 'PUT',
      body: JSON.stringify({ tags: ['rail'] }),
    })
  })

  it('forwards the caller cookie and authorization so the backend can check them', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok([]))
    const { GET } = await loadRoute({ KPI_API_URL: 'http://backend.test' })
    await GET(
      new Request('http://localhost/api/tags', {
        headers: { cookie: 'session=abc', authorization: 'Key zzz' },
      }),
      ctx(undefined)
    )

    expect(fetchSpy.mock.calls[0][1]).toMatchObject({
      headers: expect.objectContaining({ cookie: 'session=abc', authorization: 'Key zzz' }),
    })
  })

  it('refuses a traversal segment instead of forwarding it', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok([]))
    const { GET } = await loadRoute({ KPI_API_URL: 'http://backend.test' })
    const res = await GET(new Request('http://localhost/api/tags/../kpis'), ctx(['..', 'kpis']))

    expect(res.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  // The client branches on the backend's named cause, so the refusal body has
  // to arrive intact rather than be replaced with the proxy's own wording.
  it('passes the backend status and error envelope through rather than flattening them', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      ok({ error: { id: 'VEODYN_TAG_PREFIX_RESERVED', message: 'reserved prefix' } }, 422)
    )
    const { PUT } = await loadRoute({ KPI_API_URL: 'http://backend.test' })
    const res = await PUT(
      new Request('http://localhost/api/tags/kpi/k-1', {
        method: 'PUT',
        body: '{"tags":["domain:rail"]}',
      }),
      ctx(['kpi', 'k-1'])
    )

    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({
      error: { id: 'VEODYN_TAG_PREFIX_RESERVED', message: 'reserved prefix' },
    })
  })

  it('502s when the backend is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))
    const { GET } = await loadRoute({ KPI_API_URL: 'http://backend.test' })
    const res = await GET(new Request('http://localhost/api/tags'), ctx(undefined))

    expect(res.status).toBe(502)
  })
})
