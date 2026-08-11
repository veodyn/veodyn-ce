// @vitest-environment node
//
// The proxy in front of the sidecar's favorites. Two things matter here and
// nowhere else: the browser's credential has to reach the backend, because a
// favorite belongs to a person rather than to the instance, and the type
// segment is caller input that must not be forwarded blind.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FeatureDescriptor } from '@/features/types'

// The closed list of kinds the item route will relay is derived from the
// installed features, so a suite that asserted a relay against whatever the
// tree held was really asserting which packages were in it. The registry is
// stubbed with two kinds of this file's own instead: the relay is exercised for
// a kind this build serves, and the case below it stays a kind this build does
// not.
vi.mock('@/features/generated-registry', async () => {
  const { Star } = await import('lucide-react')
  const FEATURES: Record<string, FeatureDescriptor> = {
    kpis: {
      id: 'kpis',
      nav: [],
      routes: [],
      searchType: { type: 'kpi', label: 'KPIs', noun: 'KPI', icon: Star },
      slots: { 'favorites.section': async () => ({ default: () => null }) },
    },
    reports: {
      id: 'reports',
      nav: [],
      routes: [],
      searchType: { type: 'report', label: 'Reports', noun: 'report', icon: Star },
      slots: { 'favorites.section': async () => ({ default: () => null }) },
    },
  }
  return { FEATURES }
})

async function loadList(kpiUrl?: string, reportsUrl?: string) {
  vi.resetModules()
  if (kpiUrl) process.env.KPI_API_URL = kpiUrl
  else delete process.env.KPI_API_URL
  if (reportsUrl) process.env.REPORTS_API_URL = reportsUrl
  else delete process.env.REPORTS_API_URL
  return import('./route')
}

async function loadItem(kpiUrl?: string) {
  vi.resetModules()
  if (kpiUrl) process.env.KPI_API_URL = kpiUrl
  else delete process.env.KPI_API_URL
  return import('./[type]/[id]/route')
}

function params(type: string, id: string) {
  return { params: Promise.resolve({ type, id }) }
}

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.KPI_API_URL
  delete process.env.REPORTS_API_URL
})

describe('GET /api/favorites', () => {
  it('503s when KPI_API_URL is unset', async () => {
    const { GET } = await loadList(undefined)
    expect((await GET(new Request('http://localhost/api/favorites'))).status).toBe(503)
  })

  it('forwards the session cookie, since a favorite belongs to a person', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ kpi: [], report: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    const { GET } = await loadList('http://backend.test')

    const res = await GET(
      new Request('http://localhost/api/favorites', { headers: { cookie: 'session=abc' } })
    )

    expect(res.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://backend.test/favorites',
      expect.objectContaining({ headers: expect.objectContaining({ cookie: 'session=abc' }) })
    )
  })

  it('takes the reports URL when only that half is configured', async () => {
    // One veodyn-api serves /kpis, /reports and /favorites, and helm points
    // both vars at it. Reading only the KPI one would break report favorites on
    // an instance that configured just the reports half.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ kpi: [], report: [] }), { status: 200 }))
    const { GET } = await loadList(undefined, 'http://reports.test')

    expect((await GET(new Request('http://localhost/api/favorites'))).status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledWith('http://reports.test/favorites', expect.anything())
  })

  it('502s rather than throwing when the backend is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))
    const { GET } = await loadList('http://backend.test')

    expect((await GET(new Request('http://localhost/api/favorites'))).status).toBe(502)
  })
})

describe('POST/DELETE /api/favorites/:type/:id', () => {
  // Both kinds here are the stub registry's, which is what lets this case be
  // about the verbs and the empty-body status rather than about which feature
  // packages the tree it runs in contains.
  it('adds with POST and removes with DELETE, passing 204 through bare', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }))
    const { POST, DELETE } = await loadItem('http://backend.test')

    const added = await POST(
      new Request('http://localhost/api/favorites/kpi/on-time', { method: 'POST' }),
      params('kpi', 'on-time')
    )
    expect(added.status).toBe(204)
    expect(fetchSpy).toHaveBeenLastCalledWith(
      'http://backend.test/favorites/kpi/on-time',
      expect.objectContaining({ method: 'POST' })
    )

    const removed = await DELETE(
      new Request('http://localhost/api/favorites/report/q3', { method: 'DELETE' }),
      params('report', 'q3')
    )
    expect(removed.status).toBe(204)
    expect(fetchSpy).toHaveBeenLastCalledWith(
      'http://backend.test/favorites/report/q3',
      expect.objectContaining({ method: 'DELETE' })
    )
  })

  it('refuses a type it was not told about, without calling out', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { POST } = await loadItem('http://backend.test')

    const res = await POST(
      new Request('http://localhost/api/favorites/dashboard/1', { method: 'POST' }),
      params('dashboard', '1')
    )

    // Dashboards are Redash's, and this proxy carries a browser credential: an
    // unknown kind is refused here rather than tried against the sidecar.
    expect(res.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('503s when KPI_API_URL is unset', async () => {
    const { POST } = await loadItem(undefined)
    const res = await POST(
      new Request('http://localhost/api/favorites/kpi/on-time', { method: 'POST' }),
      params('kpi', 'on-time')
    )
    expect(res.status).toBe(503)
  })
})
