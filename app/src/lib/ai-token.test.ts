import { NextResponse } from 'next/server'
import { describe, expect, it } from 'vitest'
import {
  AI_TOKEN_COOKIE,
  AI_TOKEN_TTL_SECONDS,
  clearAiTokenCookie,
  mintAiToken,
  setAiTokenCookie,
  verifyAiToken,
} from './ai-token'

const SECRET = 'chat-token-secret'
const NOW = 1_800_000_000

function claimsOf(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
}

describe('ai token', () => {
  it('round trips a subject', () => {
    const token = mintAiToken(42, SECRET, NOW)
    expect(verifyAiToken(token, SECRET, NOW + 10)).toEqual({ subject: 42, expiresAt: NOW + AI_TOKEN_TTL_SECONDS })
  })

  it('carries the claims the sidecar checks', () => {
    const claims = claimsOf(mintAiToken(42, SECRET, NOW))
    expect(claims).toMatchObject({ iss: 'veodyn-app', aud: 'veodyn-api', sub: '42', iat: NOW })
    expect(claims.exp).toBe(NOW + 900)
    expect(typeof claims.jti).toBe('string')
  })

  it('refuses an expired token', () => {
    expect(verifyAiToken(mintAiToken(42, SECRET, NOW), SECRET, NOW + AI_TOKEN_TTL_SECONDS)).toBeNull()
  })

  it('refuses a token signed with another secret', () => {
    expect(verifyAiToken(mintAiToken(42, 'other', NOW), SECRET, NOW)).toBeNull()
  })

  it('refuses a tampered subject', () => {
    const [header, , signature] = mintAiToken(42, SECRET, NOW).split('.')
    const forged = Buffer.from(JSON.stringify({ ...claimsOf(mintAiToken(42, SECRET, NOW)), sub: '1' })).toString(
      'base64url'
    )
    expect(verifyAiToken(`${header}.${forged}.${signature}`, SECRET, NOW)).toBeNull()
  })

  it.each(['', 'a.b', 'a.b.c', 'x.y.z.w'])('refuses the malformed token %j', (token) => {
    expect(verifyAiToken(token, SECRET, NOW)).toBeNull()
  })

  it('refuses everything without a secret', () => {
    expect(verifyAiToken(mintAiToken(42, SECRET, NOW), '', NOW)).toBeNull()
  })

  it('sets and clears an http-only cookie scoped to the AI routes', () => {
    const set = NextResponse.json({})
    setAiTokenCookie(set, 'token-value')
    const written = set.headers.getSetCookie().find((one) => one.startsWith(`${AI_TOKEN_COOKIE}=`))
    expect(written).toContain('Path=/api/ai')
    expect(written).toContain('HttpOnly')
    expect(written).toContain('SameSite=lax')
    expect(written).toContain('Max-Age=900')

    const cleared = NextResponse.json({})
    clearAiTokenCookie(cleared)
    const removal = cleared.headers.getSetCookie().find((one) => one.startsWith(`${AI_TOKEN_COOKIE}=`))
    expect(removal).toContain('Path=/api/ai')
    expect(removal).toContain('Max-Age=0')
  })
})
