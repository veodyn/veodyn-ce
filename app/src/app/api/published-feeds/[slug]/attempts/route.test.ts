// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('the attempts proxy', () => {
  it('encodes the slug into the upstream path', async () => {
    vi.stubEnv('CATALOG_API_URL', 'http://sidecar:8000')
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('[]', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    vi.resetModules()
    const { GET } = await import('./route')

    await GET(new Request('http://localhost/api/published-feeds/a%2Fb/attempts'), {
      params: Promise.resolve({ slug: 'a/b' }),
    })

    expect(fetchMock.mock.calls[0][0]).toBe('http://sidecar:8000/published-feeds/a%2Fb/attempts')
  })

  it('posts an attempt and returns the recorded decision', async () => {
    vi.stubEnv('CATALOG_API_URL', 'http://sidecar:8000')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ decision: 'blocked' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        })
      )
    )
    vi.resetModules()
    const { POST } = await import('./route')

    const res = await POST(new Request('http://localhost/x', { method: 'POST' }), {
      params: Promise.resolve({ slug: 'vehicles' }),
    })

    expect(res.status).toBe(201)
    expect((await res.json()).decision).toBe('blocked')
  })
})
