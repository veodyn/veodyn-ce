// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { mcpSidecarTransport } from './sidecar-transport'

function okFetch() {
  const fetcher = vi.fn<typeof fetch>()
  fetcher.mockImplementation(async () => new Response('{"ok":true}', { status: 200 }))
  return fetcher
}

describe('mcpSidecarTransport', () => {
  it('calls the sidecar URL as the key holder and carries the subject token', async () => {
    const fetcher = okFetch()
    const transport = mcpSidecarTransport(
      { apiKey: 'abc123', session: null, csrfToken: null },
      'subject-token',
      () => 'http://sidecar:8000',
      fetcher
    )
    await transport.get('kpis/otp', { limit: 3 })
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('http://sidecar:8000/kpis/otp?limit=3')
    expect(init?.headers).toMatchObject({ authorization: 'Key abc123', 'x-veodyn-user-token': 'subject-token' })
  })

  it('sends only a lone session cookie for a browser session, never the whole jar', async () => {
    const fetcher = okFetch()
    const transport = mcpSidecarTransport(
      { apiKey: null, session: 'sess-1', csrfToken: 'csrf-1' },
      'subject-token',
      () => 'http://sidecar:8000',
      fetcher
    )
    await transport.patch('kpis/otp', { target: 5 })
    const headers = fetcher.mock.calls[0][1]?.headers as Record<string, string>
    expect(headers.cookie).toBe('session=sess-1')
    expect(headers).not.toHaveProperty('authorization')
  })

  it('fails the call, not the process, when no sidecar URL is configured', async () => {
    const transport = mcpSidecarTransport({ apiKey: 'k', session: null, csrfToken: null }, 't', () => null, okFetch())
    await expect(transport.get('kpis')).rejects.toThrow(/not configured/)
  })
})
