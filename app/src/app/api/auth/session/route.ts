/**
 * Session check — forwards the caller's own session cookie to Redash
 * GET /api/session and passes the payload through unmapped
 * ({user, client_config, messages} — exactly what auth-store consumes).
 *
 * Must NEVER authenticate with an API key here: the session check is how we
 * decide who the caller is.
 */

import { NextRequest, NextResponse } from 'next/server'
import { REDASH_URL, redashFetch, forwardSetCookies } from '@/lib/redash-server'
import { COOKIE_SECURE_ATTR } from '@/lib/cookie-attrs'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (!REDASH_URL) {
    return NextResponse.json({ message: 'REDASH_URL not configured.' }, { status: 503 })
  }

  if (!request.cookies.get('session')?.value) {
    return NextResponse.json({ message: 'Please login to continue.' }, { status: 401 })
  }

  try {
    const redashRes = await redashFetch('/api/session', {
      cookie: request.headers.get('cookie'),
    })

    if (!redashRes.ok) {
      // 401 (no session), 403 (disabled), 404 (no org) → all "not authenticated"
      if ([401, 403, 404].includes(redashRes.status)) {
        return NextResponse.json({ message: 'Please login to continue.' }, { status: 401 })
      }
      return NextResponse.json({ message: 'Session check failed.' }, { status: redashRes.status })
    }

    const data = await redashRes.json()
    const res = NextResponse.json(data)
    res.headers.set('Cache-Control', 'no-store')
    // Keeps the browser's session/csrf_token cookies fresh
    forwardSetCookies(redashRes, res)

    // Self-heal: sessions minted before the API-key flow (or with a lost
    // cookie) get their `redash_api_key` re-fetched via the validated session.
    const userId = data?.user?.id
    if (userId && !request.cookies.get('redash_api_key')?.value) {
      try {
        const userRes = await redashFetch(`/api/users/${userId}`, {
          cookie: request.headers.get('cookie'),
        })
        if (userRes.ok) {
          const userData = await userRes.json()
          if (userData?.api_key) {
            // Raw append, deliberately not res.cookies.set(). This response's
            // ResponseCookies map was parsed when NextResponse.json() built it,
            // before forwardSetCookies appended Redash's session/csrf refresh
            // above, and a set() rebuilds the whole Set-Cookie header from that
            // stale map. It would drop the refresh on exactly the request that
            // heals the key. Attributes match what set() serialized.
            res.headers.append(
              'Set-Cookie',
              `redash_api_key=${encodeURIComponent(userData.api_key)}; Path=/; Max-Age=${
                60 * 60 * 24 * 30
              }; HttpOnly; SameSite=Lax${COOKIE_SECURE_ATTR}`
            )
          }
        }
      } catch {
        // Non-fatal — cookie-session flow still works without the key
      }
    }
    return res
  } catch (err) {
    console.error('Session check error:', err)
    return NextResponse.json(
      { message: 'Failed to connect to authentication server.' },
      { status: 502 }
    )
  }
}
