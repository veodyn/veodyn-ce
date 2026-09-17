import { NextResponse } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mintAiToken, verifyAiToken } from '@/lib/ai-token'

const SECRET = 'chat-token-secret'

afterEach(() => {
  vi.resetModules()
  vi.doUnmock('@/lib/env')
  vi.doUnmock('@/lib/redash-server')
})

async function load(options: { secret?: string; session?: { id: number } | null } = {}) {
  vi.resetModules()
  const requireSession = vi.fn(async () => (options.session === undefined ? { id: 7 } : options.session))
  vi.doMock('@/lib/env', () => ({ env: { VEODYN_AI__TOKEN_SECRET: options.secret ?? SECRET } }))
  vi.doMock('@/lib/redash-server', () => ({ requireSession }))
  const subject = await import('./subject')
  return { ...subject, requireSession }
}

function request(cookie?: string): Request {
  return new Request('http://localhost/api/ai/chat/threads', { headers: cookie ? { cookie } : {} })
}

describe('resolveAiSubject', () => {
  it('uses a valid token without asking the query service', async () => {
    const { resolveAiSubject, requireSession } = await load()
    const token = mintAiToken(7, SECRET)
    const resolved = await resolveAiSubject(request(`session=s; veodyn_ai=${token}`))
    expect(resolved).toEqual({ ok: true, token, minted: false })
    expect(requireSession).not.toHaveBeenCalled()
  })

  it('refuses a token without a session cookie', async () => {
    const { resolveAiSubject } = await load()
    const resolved = await resolveAiSubject(request(`veodyn_ai=${mintAiToken(7, SECRET)}`))
    expect(resolved.ok).toBe(false)
    if (!resolved.ok) expect(resolved.response.status).toBe(401)
  })

  it('mints a token from the session when there is none', async () => {
    const { resolveAiSubject, withSubjectCookie, requireSession } = await load({ session: { id: 9 } })
    const resolved = await resolveAiSubject(request('session=s'))
    expect(requireSession).toHaveBeenCalledWith('session=s', expect.anything())
    expect(resolved.ok && resolved.minted).toBe(true)
    if (!resolved.ok) return
    expect(verifyAiToken(resolved.token, SECRET)?.subject).toBe(9)
    const response = withSubjectCookie(NextResponse.json({}), resolved)
    expect(response.headers.getSetCookie().some((one) => one.startsWith('veodyn_ai='))).toBe(true)
  })

  it('re-mints a token that is about to expire', async () => {
    const { resolveAiSubject } = await load()
    const nearlyExpired = mintAiToken(7, SECRET, Math.floor(Date.now() / 1000) - 880)
    const resolved = await resolveAiSubject(request(`session=s; veodyn_ai=${nearlyExpired}`))
    expect(resolved.ok && resolved.minted).toBe(true)
  })

  it('re-mints over a forged token', async () => {
    const { resolveAiSubject, requireSession } = await load({ session: { id: 7 } })
    const resolved = await resolveAiSubject(request(`session=s; veodyn_ai=${mintAiToken(1, 'forged')}`))
    expect(requireSession).toHaveBeenCalled()
    expect(resolved.ok && verifyAiToken(resolved.token, SECRET)?.subject).toBe(7)
  })

  it('refuses when the session is not valid', async () => {
    const { resolveAiSubject } = await load({ session: null })
    const resolved = await resolveAiSubject(request('session=s'))
    expect(resolved.ok).toBe(false)
    if (!resolved.ok) expect(resolved.response.status).toBe(401)
  })

  it('is unavailable without a secret', async () => {
    const { resolveAiSubject } = await load({ secret: '' })
    const resolved = await resolveAiSubject(request('session=s'))
    expect(resolved.ok).toBe(false)
    if (!resolved.ok) expect(resolved.response.status).toBe(503)
  })

  it('leaves the response alone when nothing was minted', async () => {
    const { withSubjectCookie } = await load()
    const response = withSubjectCookie(NextResponse.json({}), { ok: true, token: 't', minted: false })
    expect(response.headers.getSetCookie()).toEqual([])
  })
})
