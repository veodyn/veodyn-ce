import { NextResponse } from 'next/server'
import { AI_TOKEN_COOKIE, mintAiToken, setAiTokenCookie, verifyAiToken } from '@/lib/ai-token'
import { errorResponse, sessionCookieValue } from '@/lib/ai-proxy'
import { env } from '@/lib/env'
import { AppError, ErrorIds } from '@/lib/errorIds'
import { requireSession } from '@/lib/redash-server'

export const AI_TOKEN_REFRESH_SECONDS = 60

export type SubjectResolution =
  | { ok: true; token: string; minted: boolean }
  | { ok: false; response: NextResponse }

function cookieValue(header: string | null, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      const value = part.slice(eq + 1).trim()
      return value.length > 0 ? value : null
    }
  }
  return null
}

function refused(): SubjectResolution {
  return {
    ok: false,
    response: errorResponse(new AppError(ErrorIds.AUTH_NO_SESSION, 'Sign in to use the data chat'), 401),
  }
}

export async function resolveAiSubject(request: Request): Promise<SubjectResolution> {
  const secret = env.VEODYN_AI__TOKEN_SECRET
  if (!secret) {
    return {
      ok: false,
      response: errorResponse(
        new AppError(ErrorIds.AI_CHAT_UNAVAILABLE, 'The data chat is not configured'),
        503
      ),
    }
  }
  const cookies = request.headers.get('cookie')
  if (!sessionCookieValue(cookies)) return refused()
  const existing = cookieValue(cookies, AI_TOKEN_COOKIE)
  const verified = existing ? verifyAiToken(existing, secret) : null
  const now = Math.floor(Date.now() / 1000)
  if (existing && verified && verified.expiresAt - now > AI_TOKEN_REFRESH_SECONDS) {
    return { ok: true, token: existing, minted: false }
  }
  const session = await requireSession(cookies, request.signal)
  if (!session) return refused()
  return { ok: true, token: mintAiToken(session.id, secret, now), minted: true }
}

export function withSubjectCookie(response: NextResponse, subject: SubjectResolution): NextResponse {
  if (subject.ok && subject.minted) setAiTokenCookie(response, subject.token)
  return response
}
