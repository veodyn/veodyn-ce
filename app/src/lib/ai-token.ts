import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { NextResponse } from 'next/server'
import { COOKIE_SECURE } from '@/lib/cookie-attrs'

export const AI_TOKEN_COOKIE = 'veodyn_ai'
export const AI_TOKEN_PATH = '/api/ai'
export const AI_TOKEN_TTL_SECONDS = 900
export const AI_TOKEN_ISSUER = 'veodyn-app'
export const AI_TOKEN_AUDIENCE = 'veodyn-api'

export interface VerifiedAiToken {
  subject: number
  expiresAt: number
}

function encode(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url')
}

function sign(input: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(input).digest()
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

export function mintAiToken(subject: number, secret: string, now: number = nowSeconds()): string {
  const header = encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const claims = encode(
    JSON.stringify({
      iss: AI_TOKEN_ISSUER,
      aud: AI_TOKEN_AUDIENCE,
      sub: String(subject),
      iat: now,
      exp: now + AI_TOKEN_TTL_SECONDS,
      jti: randomUUID(),
    })
  )
  return `${header}.${claims}.${encode(sign(`${header}.${claims}`, secret))}`
}

function parse(part: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
    return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function verifyAiToken(
  token: string,
  secret: string,
  now: number = nowSeconds()
): VerifiedAiToken | null {
  const parts = token.split('.')
  if (parts.length !== 3 || !secret) return null
  const header = parse(parts[0])
  const claims = parse(parts[1])
  if (header?.alg !== 'HS256' || claims === null) return null
  const expected = sign(`${parts[0]}.${parts[1]}`, secret)
  const given = Buffer.from(parts[2], 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  if (claims.iss !== AI_TOKEN_ISSUER || claims.aud !== AI_TOKEN_AUDIENCE) return null
  const subject = Number(claims.sub)
  const expiresAt = claims.exp
  if (!Number.isInteger(subject) || typeof expiresAt !== 'number' || expiresAt <= now) return null
  return { subject, expiresAt }
}

const cookieOptions = {
  path: AI_TOKEN_PATH,
  httpOnly: true,
  sameSite: 'lax',
  secure: COOKIE_SECURE,
} as const

export function setAiTokenCookie(response: NextResponse, token: string): void {
  response.cookies.set(AI_TOKEN_COOKIE, token, { ...cookieOptions, maxAge: AI_TOKEN_TTL_SECONDS })
}

export function clearAiTokenCookie(response: NextResponse): void {
  response.cookies.set(AI_TOKEN_COOKIE, '', { ...cookieOptions, maxAge: 0 })
}
