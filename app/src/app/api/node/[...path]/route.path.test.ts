// @vitest-environment node
//
// Where a proxied request actually lands. The catch-all interpolated its path
// segments raw, and `new URL()` resolves dot segments, so a `..` walked out of
// the backend's /api/ namespace. Next's router normalises a literal `../` away
// before a handler sees it, which is what made this look unreachable, but it
// does not normalise one hidden inside a single segment: `/api/node/..%2flogin`
// arrives here as the one segment `../login`.
//
// These assert on the URL the proxy dials, which is the only place the answer
// is visible: the request never has to leave the machine to be wrong.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const BACKEND = 'https://redash.example'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetModules()
})

async function loadRoute() {
  vi.stubEnv('REDASH_URL', BACKEND)
  vi.resetModules()
  return import('./route')
}

function ctx(path: string[]) {
  return { params: Promise.resolve({ path }) }
}

function stubFetch() {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

// A session cookie, so the proxy's own unauthenticated gate does not answer
// first and hide what the path handling would have done.
function request(path: string) {
  return new NextRequest(`http://localhost/api/node/${path}`, {
    headers: { cookie: 'session=abc' },
  })
}

function dialled(mock: ReturnType<typeof stubFetch>): string {
  const call = mock.mock.calls[0]
  if (!call) throw new Error('Expected an outbound fetch')
  return String(call[0])
}

describe('proxy target path', () => {
  it('leaves an ordinary path alone', async () => {
    const fetchMock = stubFetch()
    const { GET } = await loadRoute()

    await GET(request('queries/1/results.json'), ctx(['queries', '1', 'results.json']))

    expect(dialled(fetchMock)).toBe(`${BACKEND}/api/queries/1/results.json`)
  })

  it('leaves a base64url share token alone', async () => {
    const fetchMock = stubFetch()
    const { GET } = await loadRoute()

    await GET(request('dashboards/public/aB3-_x.y'), ctx(['dashboards', 'public', 'aB3-_x.y']))

    expect(dialled(fetchMock)).toBe(`${BACKEND}/api/dashboards/public/aB3-_x.y`)
  })

  it('keeps a segment holding ../ inside the api namespace', async () => {
    const fetchMock = stubFetch()
    const { GET } = await loadRoute()

    // The reachable case: this is what Next hands the handler for a request to
    // /api/node/..%2flogin. Unencoded it resolved to `${BACKEND}/login`.
    await GET(request('..%2flogin'), ctx(['../login']))

    const url = dialled(fetchMock)
    expect(url).toBe(`${BACKEND}/api/..%2Flogin`)
    expect(url.startsWith(`${BACKEND}/api/`)).toBe(true)
  })

  it('keeps a deeper traversal inside the api namespace', async () => {
    const fetchMock = stubFetch()
    const { GET } = await loadRoute()

    await GET(request('queries/..%2f..%2flogin'), ctx(['queries', '../../login']))

    expect(dialled(fetchMock).startsWith(`${BACKEND}/api/`)).toBe(true)
  })

  it('refuses a bare traversal segment without dialling out', async () => {
    const fetchMock = stubFetch()
    const { GET } = await loadRoute()

    const res = await GET(request('../login'), ctx(['..', 'login']))

    expect(res.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses an empty segment without dialling out', async () => {
    const fetchMock = stubFetch()
    const { GET } = await loadRoute()

    const res = await GET(request('queries//1'), ctx(['queries', '', '1']))

    expect(res.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('still sends ping to the backend root, which is not under /api', async () => {
    const fetchMock = stubFetch()
    const { GET } = await loadRoute()

    await GET(request('ping'), ctx(['ping']))

    expect(dialled(fetchMock)).toBe(`${BACKEND}/ping`)
  })
})
