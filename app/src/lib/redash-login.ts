import { NextResponse } from 'next/server'
import {
  REDASH_URL,
  redashFetch,
  parseSetCookieHeaders,
  buildCookieHeader,
} from '@/lib/redash-server'
import { COOKIE_SECURE } from '@/lib/cookie-attrs'
import { mintAiToken, setAiTokenCookie } from '@/lib/ai-token'
import { env } from '@/lib/env'

const CSRF_TOKEN_IN_LOGIN_FORM = /name="csrf_token"\s+value="([^"]+)"/
const REDIRECT_MEANS_ACCEPTED = 302
const THIRTY_DAYS_IN_SECONDS = 60 * 60 * 24 * 30

const persistentCookie = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax',
  secure: COOKIE_SECURE,
  maxAge: THIRTY_DAYS_IN_SECONDS,
} as const

async function fetchPersonalApiKey(userId: unknown, cookie: string): Promise<string> {
  if (!userId) return ''
  try {
    const userRes = await redashFetch(`/api/users/${userId}`, { cookie })
    if (!userRes.ok) return ''
    const userData = await userRes.json()
    return userData?.api_key || ''
  } catch {
    return ''
  }
}

export async function redashFormLogin(email: string, password: string): Promise<NextResponse> {
  if (!REDASH_URL) {
    return NextResponse.json({ message: 'REDASH_URL not configured.' }, { status: 503 })
  }

  try {
    const loginPageRes = await redashFetch('/login')
    const csrfMatch = (await loginPageRes.text()).match(CSRF_TOKEN_IN_LOGIN_FORM)
    if (!csrfMatch) {
      return NextResponse.json(
        { message: 'The query service is not ready. Organization may need setup.', needsSetup: true },
        { status: 503 }
      )
    }
    const cookieJar = parseSetCookieHeaders(loginPageRes)

    const loginRes = await redashFetch('/login', {
      method: 'POST',
      body: new URLSearchParams({ email, password, csrf_token: csrfMatch[1] }).toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      cookie: buildCookieHeader(cookieJar),
    })

    if (loginRes.status !== REDIRECT_MEANS_ACCEPTED) {
      if (loginRes.status === 400) {
        return NextResponse.json(
          { message: 'Login failed. CSRF token invalid, please retry.' },
          { status: 400 }
        )
      }
      return NextResponse.json({ message: 'Invalid email or password.' }, { status: 401 })
    }

    if ((loginRes.headers.get('location') || '').includes('/setup')) {
      return NextResponse.json(
        { message: 'Organization setup required.', needsSetup: true },
        { status: 403 }
      )
    }

    for (const [name, value] of parseSetCookieHeaders(loginRes)) {
      cookieJar.set(name, value)
    }

    const authenticatedCookie = buildCookieHeader(cookieJar)
    const sessionRes = await redashFetch('/api/session', { cookie: authenticatedCookie })
    if (!sessionRes.ok) {
      return NextResponse.json(
        { message: 'Login succeeded but failed to load session.' },
        { status: 500 }
      )
    }
    const sessionData = await sessionRes.json()
    const userApiKey = await fetchPersonalApiKey(sessionData?.user?.id, authenticatedCookie)

    const res = NextResponse.json({ user: sessionData.user })

    const sessionCookie = cookieJar.get('session')
    if (sessionCookie) {
      res.cookies.set('session', sessionCookie, persistentCookie)
    }
    const csrfCookie = cookieJar.get('csrf_token')
    if (csrfCookie) {
      res.cookies.set('csrf_token', csrfCookie, {
        path: '/',
        httpOnly: false,
        sameSite: 'lax',
        secure: COOKIE_SECURE,
      })
    }
    if (userApiKey) {
      res.cookies.set('redash_api_key', userApiKey, persistentCookie)
    }
    const userId = sessionData?.user?.id
    if (env.VEODYN_AI__TOKEN_SECRET && Number.isInteger(userId)) {
      setAiTokenCookie(res, mintAiToken(userId, env.VEODYN_AI__TOKEN_SECRET))
    }

    return res
  } catch (err) {
    console.error('query service login error:', err)
    return NextResponse.json(
      { message: 'Failed to connect to authentication server.' },
      { status: 502 }
    )
  }
}
