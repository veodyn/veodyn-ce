/**
 * Catch-all proxy for the Redash API. The browser talks to `/api/node/*` and
 * this forwards to REDASH_URL, preserving session cookies and CSRF tokens.
 * `/api/redash/*` re-exports these handlers as a deprecation alias; see
 * `../redash/[...path]/route.ts`.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  isKeyedResultsPath,
  isPublicPath,
  isTextualContentType,
  safeApiPath,
  stripOwnCookies,
} from './proxy-guards'
import { COOKIE_SECURE_ATTR } from '@/lib/cookie-attrs'

// Never cache: dashboards/queries carry volatile fields like
// latest_query_data_id, so a cached GET serves stale result pointers.
export const dynamic = 'force-dynamic'

const REDASH_URL = process.env.REDASH_URL || ''

function getRedashUrl(path: string[]): string | null {
  // Redash's ping (refreshes the csrf_token cookie) lives at the root, outside
  // the /api/* namespace.
  if (path.length === 1 && path[0] === 'ping') {
    return `${REDASH_URL}/ping`
  }
  const suffix = safeApiPath(path)
  if (suffix === null) return null
  return `${REDASH_URL}/api/${suffix}`
}

async function proxyRequest(
  request: NextRequest,
  params: Promise<{ path: string[] }>,
  method: string
) {
  const { path } = await params

  if (!REDASH_URL) {
    return NextResponse.json(
      { error: 'REDASH_URL not configured. Set it in .env to connect to a real query service.' },
      { status: 503 }
    )
  }

  const target = getRedashUrl(path)
  if (target === null) {
    // 404, not 400: a caller probing for traversal learns nothing from it.
    return NextResponse.json({ message: 'Not found.' }, { status: 404 })
  }

  const url = new URL(target)

  // `append`, not `set`: Redash list filtering takes repeated keys
  // (?tags=a&tags=b), and `set` collapses two tags into one narrower page.
  request.nextUrl.searchParams.forEach((value, key) => {
    url.searchParams.append(key, value)
  })

  // Forward cookies from browser to Redash (session cookie, CSRF)
  const cookieHeader = stripOwnCookies(request.headers.get('cookie') || '')

  // Reject unauthenticated requests before they reach Redash. A keyed results
  // URL passes: its ?api_key= is the credential, and Redash validates it.
  const hasSession = !!request.cookies.get('session')?.value
  const userApiKey = request.cookies.get('redash_api_key')?.value || ''
  const authHeader = request.headers.get('authorization')
  const keyedResults = isKeyedResultsPath(request, path)
  if (!hasSession && !userApiKey && !authHeader && !keyedResults && !isPublicPath(path)) {
    return NextResponse.json({ message: 'Please login to continue.' }, { status: 401 })
  }

  const headers: Record<string, string> = {
    'Content-Type': request.headers.get('content-type') || 'application/json',
  }

  // Whether this request authenticates with an API key rather than the caller's
  // session cookie. Decides Set-Cookie handling on the way back out (below).
  let usedApiKeyAuth = false

  if (authHeader) {
    // Client-supplied API key (public/embed access) wins
    headers['Authorization'] = authHeader
    usedApiKeyAuth = true
  } else if (userApiKey && !isPublicPath(path)) {
    // The user's own API key (set at login). No session cookie alongside it:
    // Flask-Login prefers session auth, which re-enables Redash's CSRF check,
    // and API-key requests are CSRF-exempt.
    headers['Authorization'] = `Key ${userApiKey}`
    usedApiKeyAuth = true
  } else {
    // Cookie-session fallback (no API key yet, or public paths like /ping
    // that refresh the csrf_token cookie)
    if (cookieHeader) {
      headers['Cookie'] = cookieHeader
    }
    const csrfToken = request.headers.get('x-csrf-token')
    if (csrfToken) {
      headers['X-CSRF-TOKEN'] = csrfToken
    }
  }

  // An anonymous keyed-results request authenticates by its URL alone, so it
  // counts as API-key auth on the way back out: Redash answers it with a new
  // empty session whose Set-Cookie would overwrite a real login. With a session
  // present, Redash authenticates that session and its refresh must keep flowing.
  if (keyedResults && !hasSession) {
    usedApiKeyAuth = true
  }

  const fetchOptions: RequestInit = {
    method,
    headers,
    // Let the client handle 302s (e.g. login redirect).
    redirect: 'manual',
  }

  if (method !== 'GET' && method !== 'HEAD') {
    try {
      const body = await request.text()
      if (body) fetchOptions.body = body
    } catch {
      // No body
    }
  }

  try {
    const response = await fetch(url.toString(), fetchOptions)

    // Text is read as text so the branches below can inspect it (the 401 retry
    // reads the body). Everything else stays bytes: response.text() decodes as
    // UTF-8 and silently corrupts a query's results.xlsx.
    const contentType = response.headers.get('content-type') || ''
    const body: string | ArrayBuffer = isTextualContentType(contentType)
      ? await response.text()
      : await response.arrayBuffer()

    // 204/205/304 must be constructed with a NULL body: the `''` that
    // response.text() returns still counts as a body, so the Response
    // constructor throws and the catch below relabels a call that SUCCEEDED as
    // a 502. Redash returns make_response("", 204) from data_sources.py and
    // destinations.py.
    const isNullBodyStatus = [204, 205, 304].includes(response.status)
    const res = new NextResponse(isNullBodyStatus ? null : body, {
      status: response.status,
      statusText: response.statusText,
    })

    if (contentType) {
      res.headers.set('Content-Type', contentType)
    }

    // The filename Redash chose for a download. Without it every export lands
    // under whatever the URL's last segment was.
    const disposition = response.headers.get('content-disposition')
    if (disposition) {
      res.headers.set('Content-Disposition', disposition)
    }

    res.headers.set('Cache-Control', 'no-store')

    // Forward Set-Cookie ONLY when we authenticated with the caller's session
    // cookie. An API-key request is anonymous to Flask-Login, so Redash answers
    // with a brand-new empty session that would overwrite the browser's real
    // login cookie and sign the user out on the next navigation.
    if (!usedApiKeyAuth) {
      const setCookies = response.headers.getSetCookie()
      for (const cookie of setCookies) {
        res.headers.append('Set-Cookie', cookie)
      }
    }

    // Regenerating your OWN API key invalidates the `redash_api_key` cookie set
    // at login, so refresh it here. Only for the session user's own key: an
    // admin regenerating someone else's must not adopt their identity.
    if (
      method === 'POST' &&
      response.ok &&
      path.length === 3 &&
      path[0] === 'users' &&
      path[2] === 'regenerate_api_key'
    ) {
      const sessionCookie = request.cookies.get('session')?.value
      if (sessionCookie) {
        try {
          const sessionRes = await fetch(`${REDASH_URL}/api/session`, {
            headers: { Cookie: `session=${sessionCookie}` },
            cache: 'no-store',
          })
          if (sessionRes.ok) {
            const sessionData = await sessionRes.json()
            if (String(sessionData?.user?.id) === path[1]) {
              const newKey = JSON.parse(body as string)?.api_key
              if (newKey) {
                // Raw header, not res.cookies.set: NextResponse builds its
                // ResponseCookies map in the constructor, before the Set-Cookie
                // appends above, so every .set() rewrites the whole header from
                // that stale map and drops Redash's forwarded session refresh.
                // encodeURIComponent matches what ResponseCookies did.
                const maxAge = 60 * 60 * 24 * 30
                res.headers.append(
                  'Set-Cookie',
                  `redash_api_key=${encodeURIComponent(newKey)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${COOKIE_SECURE_ATTR}`
                )
              }
            }
          }
        } catch {
          // Non-fatal: the user can re-login to refresh the cookie.
        }
      }
    }

    return res
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Proxy error'
    return NextResponse.json(
      { error: `Failed to reach the query service: ${message}` },
      { status: 502 }
    )
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxyRequest(req, ctx.params, 'GET')
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxyRequest(req, ctx.params, 'POST')
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxyRequest(req, ctx.params, 'PUT')
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxyRequest(req, ctx.params, 'DELETE')
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxyRequest(req, ctx.params, 'PATCH')
}
