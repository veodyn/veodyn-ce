import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/services/api-client'
import { browserSidecarTransport, createSidecarTransport } from './sidecar-transport'

function reply(status: number, body: unknown) {
  const fetcher = vi.fn<typeof fetch>()
  fetcher.mockImplementation(
    async () =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })
  )
  return fetcher
}

describe('sidecar transport', () => {
  it('reads and writes through the same-origin /api routes in the browser', async () => {
    const fetcher = reply(200, { id: 'k' })
    vi.stubGlobal('fetch', fetcher)
    try {
      await browserSidecarTransport.get('kpis/k', { limit: 2 })
      await browserSidecarTransport.patch('kpis/k', { target: 5 })
    } finally {
      vi.unstubAllGlobals()
    }
    expect(fetcher.mock.calls[0][0]).toBe('/api/kpis/k?limit=2')
    expect(fetcher.mock.calls[0][1]?.method).toBe('GET')
    expect(fetcher.mock.calls[1][1]).toMatchObject({ method: 'PATCH', body: '{"target":5}' })
  })

  it('addresses an absolute sidecar with the headers it is given', async () => {
    const fetcher = reply(201, { ok: true })
    const transport = createSidecarTransport({
      address: (path) => `http://sidecar:8000/${path}`,
      headers: () => ({ authorization: 'Key abc', 'x-veodyn-user-token': 'tok' }),
      fetcher,
    })
    await transport.post('kpis', { name: 'n' })
    expect(fetcher.mock.calls[0][0]).toBe('http://sidecar:8000/kpis')
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ authorization: 'Key abc', 'x-veodyn-user-token': 'tok' })
  })

  it('throws an ApiError carrying the status and the sidecar message', async () => {
    const transport = createSidecarTransport({
      address: (path) => `/${path}`,
      headers: () => ({}),
      fetcher: reply(409, { detail: 'revision changed' }),
    })
    await expect(transport.post('reports/1/publish', {})).rejects.toMatchObject({
      status: 409,
      message: 'revision changed',
    })
    await expect(transport.post('reports/1/publish', {})).rejects.toBeInstanceOf(ApiError)
  })
})
