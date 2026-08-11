/**
 * Login — performs Redash's CSRF-protected form login server-side.
 *
 * Redash login is NOT a JSON API: it's a form POST at the root /login path
 * (outside /api/*), so it can't go through the catch-all proxy. Flow:
 *   1. GET /login → scrape csrf_token from the HTML + collect cookies
 *   2. form-POST /login with email/password/csrf_token
 *      302 → success, 200 → re-rendered form (bad credentials)
 *   3. GET /api/session with the authenticated cookie jar
 *   4. Set the Flask `session` cookie (httpOnly) on our own origin
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  REDASH_URL,
  redashFetch,
  parseSetCookieHeaders,
  buildCookieHeader,
} from '@/lib/redash-server'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const { email, password } = body as { email?: string; password?: string }

  if (!email || !password) {
    return NextResponse.json(
      { message: 'Email and password are required.' },
      { status: 400 }
    )
  }

  if (!REDASH_URL) {
    return NextResponse.json(
      { message: 'REDASH_URL not configured.' },
      { status: 503 }
    )
  }

  try {
    // Step 1: GET /login for the CSRF token and initial cookies
    const loginPageRes = await redashFetch('/login')
    const loginPageHtml = await loginPageRes.text()
    const csrfMatch = loginPageHtml.match(/name="csrf_token"\s+value="([^"]+)"/)
    if (!csrfMatch) {
      return NextResponse.json(
        { message: 'The query service is not ready. Organization may need setup.', needsSetup: true },
        { status: 503 }
      )
    }
    const cookieJar = parseSetCookieHeaders(loginPageRes)

    // Step 2: form-POST /login
    const formData = new URLSearchParams({
      email,
      password,
      csrf_token: csrfMatch[1],
    })
    const loginRes = await redashFetch('/login', {
      method: 'POST',
      body: formData.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      cookie: buildCookieHeader(cookieJar),
    })

    if (loginRes.status !== 302) {
      if (loginRes.status === 400) {
        return NextResponse.json(
          { message: 'Login failed. CSRF token invalid, please retry.' },
          { status: 400 }
        )
      }
      return NextResponse.json(
        { message: 'Invalid email or password.' },
        { status: 401 }
      )
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

    // Step 3: confirm the session and get the user payload
    const sessionRes = await redashFetch('/api/session', {
      cookie: buildCookieHeader(cookieJar),
    })
    if (!sessionRes.ok) {
      return NextResponse.json(
        { message: 'Login succeeded but failed to load session.' },
        { status: 500 }
      )
    }
    const sessionData = await sessionRes.json()

    // Step 3.5: fetch the user's personal API key so the proxy can
    // authenticate data traffic with `Authorization: Key` instead of the
    // Flask session cookie (API-key auth is CSRF-exempt in Redash).
    let userApiKey = ''
    const userId = sessionData?.user?.id
    if (userId) {
      try {
        const userRes = await redashFetch(`/api/users/${userId}`, {
          cookie: buildCookieHeader(cookieJar),
        })
        if (userRes.ok) {
          const userData = await userRes.json()
          userApiKey = userData?.api_key || ''
        }
      } catch {
        // Non-fatal — the session cookie flow still works without the key
      }
    }

    // Step 4: set our origin's cookies
    const res = NextResponse.json({ user: sessionData.user })

    const sessionCookie = cookieJar.get('session')
    if (sessionCookie) {
      res.cookies.set('session', sessionCookie, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 30,
      })
    }
    // Redash (Flask-WTF) re-issues csrf_token on responses; seed it so the
    // client's X-CSRF-TOKEN header works from the first mutation.
    const csrfCookie = cookieJar.get('csrf_token')
    if (csrfCookie) {
      res.cookies.set('csrf_token', csrfCookie, {
        path: '/',
        httpOnly: false,
        sameSite: 'lax',
      })
    }
    if (userApiKey) {
      res.cookies.set('redash_api_key', userApiKey, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 30,
      })
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
