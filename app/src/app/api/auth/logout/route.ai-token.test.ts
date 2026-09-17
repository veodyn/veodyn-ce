import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('logout and the chat token', () => {
  it('clears the token on the path it was set on', async () => {
    vi.stubEnv('REDASH_URL', '')
    vi.resetModules()
    const { POST } = await import('./route')
    const res = await POST(new NextRequest('http://localhost/api/auth/logout', { method: 'POST' }))
    const cleared = res.headers.getSetCookie().find((one) => one.startsWith('veodyn_ai='))
    expect(cleared).toContain('Path=/api/ai')
    expect(cleared).toContain('Max-Age=0')
  })
})
