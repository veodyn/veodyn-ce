/**
 * Same-origin proxy for the feed-metadata backend (Feed Health).
 *
 * GET /api/feeds -> CATALOG_API_URL/feeds (api/veodyn_api/routers/feeds.py).
 *
 * 503s when CATALOG_API_URL is unset (see ../catalog/route.ts), which is the
 * one status useFeeds falls back to fixtures on.
 */

import { NextResponse } from 'next/server'
import { env } from '@/lib/env'

export const dynamic = 'force-dynamic'

// The caller's own credentials, so the backend enforces per-user permissions
// instead of trusting every request that reaches this proxy.
function forwardedHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = { accept: 'application/json' }
  const cookie = request.headers.get('cookie')
  if (cookie) headers.cookie = cookie
  const authorization = request.headers.get('authorization')
  if (authorization) headers.authorization = authorization
  return headers
}

async function forward(request: Request, path: string, init?: RequestInit) {
  const base = env.CATALOG_API_URL?.replace(/\/+$/, '')
  if (!base) {
    return NextResponse.json({ error: 'CATALOG_API_URL not configured' }, { status: 503 })
  }

  try {
    const upstream = await fetch(`${base}${path}`, {
      ...init,
      signal: request.signal,
      headers: { ...forwardedHeaders(request), ...(init?.headers as Record<string, string>) },
    })
    const body = await upstream.text()
    // 204 carries no body, and handing NextResponse a body with that status
    // throws. The PUT below answers 204, so this is its normal path.
    if (upstream.status === 204 || body === '') {
      return new NextResponse(null, { status: upstream.status })
    }
    return new NextResponse(body, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    })
  } catch {
    return NextResponse.json({ error: 'catalog backend unreachable' }, { status: 502 })
  }
}

export async function GET(request: Request) {
  return forward(request, '/feeds')
}

/**
 * Declaring how often a feed is expected to deliver. The feed id rides in a
 * query parameter: this route has no dynamic segment, and the id is a warehouse
 * table name (`historical.q_regional_demo_bikeshare_stations_32`).
 */
export async function PUT(request: Request) {
  const params = new URL(request.url).searchParams
  const feedId = params.get('feedId')
  if (!feedId) {
    return NextResponse.json({ error: 'feedId is required' }, { status: 400 })
  }
  // Two writes on one feed, named rather than inferred from the body shape,
  // which would send a malformed body to whichever endpoint it guessed.
  const resource = params.get('resource') === 'alert' ? 'alert' : 'expectation'
  const body = await request.text()
  return forward(request, `/feeds/${encodeURIComponent(feedId)}/${resource}`, {
    method: 'PUT',
    body,
    headers: { 'content-type': 'application/json' },
  })
}
