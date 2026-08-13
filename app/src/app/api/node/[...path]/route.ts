/**
 * Catch-all proxy for Redash API.
 *
 * Forwards requests from the Next.js client to the Redash backend,
 * preserving cookies (session) and CSRF tokens.
 *
 * This replaces the original Redash client's direct same-origin requests.
 * The browser talks to Next.js (/api/node/*), and Next.js proxies to the
 * actual Redash backend (REDASH_URL). `/api/redash/*` re-exports the
 * handlers below as a deprecation alias; see `../redash/[...path]/route.ts`.
 *
 * Cookie flow:
 *   Browser → Next.js proxy → Redash backend
 *   Browser ← Next.js proxy ← Redash backend (Set-Cookie forwarded)
 *
 * Supports: GET, POST, PUT, DELETE, PATCH
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  isKeyedResultsPath,
  isPublicPath,
  isTextualContentType,
  stripOwnCookies,
} from './proxy-guards'

// Never cache proxied responses — dashboards/queries carry volatile fields
// like latest_query_data_id; a cached GET serves stale result pointers.
export const dynamic = 'force-dynamic'

const REDASH_URL = process.env.REDASH_URL || ''

function getRedashUrl(path: string[]): string {
  // Redash's ping (used to refresh the csrf_token cookie) lives at the root,
  // outside the /api/* namespace.
  if (path.length === 1 && path[0] === 'ping') {
    return `${REDASH_URL}/ping`
  }
  return `${REDASH_URL}/api/${path.join('/')}`
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

  const url = new URL(getRedashUrl(path))

  // Forward query params. `append`, not `set`: Redash list filtering takes
  // repeated keys (?tags=a&tags=b) and services/api-client.ts appends them on
  // purpose, so `set` collapsed two tags into one and answered a valid, wrong,
  // narrower page with nothing surfacing anywhere. getRedashUrl builds a
  // path-only URL, so there is no pre-existing param here to duplicate.
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

  // Build headers to forward
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
    // Authenticate with the user's own API key (set at login). Deliberately
    // do NOT forward the session cookie alongside it: Flask-Login prefers
    // session auth, which would re-enable Redash's CSRF check. API-key
    // requests are CSRF-exempt.
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

  // An anonymous keyed-results request authenticates by its URL alone, so
  // nothing was attached above. It still counts as API-key auth on the way
  // back out: Redash answers it with a brand-new empty session, and forwarding
  // that Set-Cookie would overwrite a real login (same hazard as the header
  // branches). With a session present, Redash authenticates the session and
  // its cookie refresh must keep flowing.
  if (keyedResults && !hasSession) {
    usedApiKeyAuth = true
  }

  // Build fetch options
  const fetchOptions: RequestInit = {
    method,
    headers,
    // Don't follow redirects — let the client handle 302s (e.g., login redirect)
    redirect: 'manual',
  }

  // Forward body for non-GET requests
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

    // Read response body.
    //
    // Text is read as text so the branches below can inspect it (the 401 retry
    // reads the body). Everything else is read as bytes and passed through
    // untouched: this used to call response.text() for both, which decodes as
    // UTF-8 and silently corrupts anything binary. A query's results.xlsx is
    // the case that matters, and a corrupt spreadsheet does not announce
    // itself, it just fails to open.
    const contentType = response.headers.get('content-type') || ''
    const body: string | ArrayBuffer = isTextualContentType(contentType)
      ? await response.text()
      : await response.arrayBuffer()

    // Build response, forwarding status and key headers.
    //
    // 204/205/304 must be constructed with a NULL body. The `''` that
    // response.text() returns for an empty body still counts as a body, so the
    // Response constructor throws "Invalid response status code 204", and that
    // throw lands in the catch below, which relabels a call that SUCCEEDED as a
    // 502 backend outage. Redash returns make_response("", 204) from both
    // data_sources.py and destinations.py, so deleting a data source reported
    // an outage while the row was already gone on the backend.
    const isNullBodyStatus = [204, 205, 304].includes(response.status)
    const res = new NextResponse(isNullBodyStatus ? null : body, {
      status: response.status,
      statusText: response.statusText,
    })

    // Forward content type
    if (contentType) {
      res.headers.set('Content-Type', contentType)
    }

    // The filename Redash chose for a download. Without it every export lands
    // under whatever the URL's last segment was, regardless of which query
    // produced it.
    const disposition = response.headers.get('content-disposition')
    if (disposition) {
      res.headers.set('Content-Disposition', disposition)
    }

    res.headers.set('Cache-Control', 'no-store')

    // Forward Set-Cookie headers (session cookies from Redash). Critical for
    // cookie-based auth to work.
    //
    // But ONLY when we authenticated with the caller's session cookie. An
    // API-key request is anonymous as far as Flask-Login is concerned, so
    // Redash answers it with a brand-new empty session plus its CSRF token.
    // Forwarding those would overwrite the browser's real login cookie and
    // silently sign the user out on the next navigation.
    if (!usedApiKeyAuth) {
      const setCookies = response.headers.getSetCookie()
      for (const cookie of setCookies) {
        res.headers.append('Set-Cookie', cookie)
      }
    }

    // Regenerating your OWN API key invalidates the `redash_api_key` cookie
    // set at login — refresh it from the response so the very next request
    // doesn't fail with a dead key. (Only for the session user's own key:
    // an admin regenerating someone else's must not adopt their identity.)
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
                // Raw header, deliberately NOT res.cookies.set. NextResponse
                // builds its ResponseCookies map in the constructor, before the
                // Set-Cookie appends above, and every .set() rewrites the whole
                // header from that stale map. So the cookies API DELETED
                // Redash's forwarded session refresh, on exactly the request
                // that heals the key. encodeURIComponent matches what
                // ResponseCookies did, since RequestCookies decodes on the way
                // back in; Max-Age alone outranks Expires everywhere.
                const maxAge = 60 * 60 * 24 * 30
                res.headers.append(
                  'Set-Cookie',
                  `redash_api_key=${encodeURIComponent(newKey)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`
                )
              }
            }
          }
        } catch {
          // Non-fatal — user can re-login to refresh the cookie
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
