import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { verifyAiToken } from '@/lib/ai-token'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

function upstream(userId: unknown) {
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  return vi
    .fn()
    .mockResolvedValueOnce(
      new Response('<input name="csrf_token" value="csrf-1">', {
        status: 200,
        headers: { 'set-cookie': 'csrf_token=csrf-1; Path=/' },
      })
    )
    .mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: '/', 'set-cookie': 'session=s-1; Path=/' } })
    )
    .mockResolvedValueOnce(json({ user: { id: userId } }))
    .mockResolvedValueOnce(json({ api_key: 'k' }))
}

async function login(secret: string, userId: unknown) {
  vi.stubEnv('REDASH_URL', 'https://redash.example')
  vi.stubEnv('VEODYN_AI__TOKEN_SECRET', secret)
  vi.stubGlobal('fetch', upstream(userId))
  vi.resetModules()
  const { POST } = await import('./route')
  return POST(
    new NextRequest('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', password: 'p' }),
    })
  )
}

function tokenCookie(res: Response): string | undefined {
  return res.headers.getSetCookie().find((one) => one.startsWith('veodyn_ai='))
}

describe('login and the chat token', () => {
  it('mints a token for the signed-in user', async () => {
    const res = await login('chat-secret', 7)
    const cookie = tokenCookie(res)
    expect(cookie).toContain('Path=/api/ai')
    const token = (cookie ?? '').split(';')[0].slice('veodyn_ai='.length)
    expect(verifyAiToken(token, 'chat-secret')?.subject).toBe(7)
  })

  it('mints nothing without a secret', async () => {
    expect(tokenCookie(await login('', 7))).toBeUndefined()
  })

  it('mints nothing without a numeric user id', async () => {
    expect(tokenCookie(await login('chat-secret', 'seven'))).toBeUndefined()
  })
})
