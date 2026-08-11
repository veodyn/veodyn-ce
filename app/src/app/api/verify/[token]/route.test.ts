// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

async function loadRoute(redashUrl: string) {
  vi.stubEnv('REDASH_URL', redashUrl)
  vi.resetModules()
  return import('./route')
}

function verifyRequest() {
  return new Request('http://localhost/api/verify/some-token')
}

describe('verify route', () => {
  it('reports verified when the upstream GET succeeds', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('<html>verify.html</html>', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { GET } = await loadRoute('https://redash.example')
    const res = await GET(verifyRequest(), { params: Promise.resolve({ token: 'some-token' }) })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'verified' })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://redash.example/verify/some-token',
      expect.anything()
    )
  })

  it('reports invalid when the upstream rejects the token with 400', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('<html>error.html</html>', { status: 400 }))
    vi.stubGlobal('fetch', fetchMock)

    const { GET } = await loadRoute('https://redash.example')
    const res = await GET(verifyRequest(), { params: Promise.resolve({ token: 'bad-token' }) })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ status: 'invalid' })
  })

  it('reports error when the upstream is unreachable', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('ECONNREFUSED'))
    vi.stubGlobal('fetch', fetchMock)

    const { GET } = await loadRoute('https://redash.example')
    const res = await GET(verifyRequest(), { params: Promise.resolve({ token: 'some-token' }) })

    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ status: 'error' })
  })

  it('reports error on an unexpected upstream status without treating it as invalid', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('Internal Server Error', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    const { GET } = await loadRoute('https://redash.example')
    const res = await GET(verifyRequest(), { params: Promise.resolve({ token: 'some-token' }) })

    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ status: 'error' })
  })

  it('percent-encodes the token before placing it in the upstream path', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { GET } = await loadRoute('https://redash.example')
    await GET(verifyRequest(), { params: Promise.resolve({ token: 'a/b c' }) })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://redash.example/verify/a%2Fb%20c',
      expect.anything()
    )
  })

  it('answers 503 without calling Redash when REDASH_URL is unset', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { GET } = await loadRoute('')
    const res = await GET(verifyRequest(), { params: Promise.resolve({ token: 'some-token' }) })

    expect(res.status).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
