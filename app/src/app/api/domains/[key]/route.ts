/**
 * Same-origin proxy for a single Data Catalog domain hub.
 *
 * GET /api/domains/[key] -> CATALOG_API_URL/domains/[key]
 *
 * 503s when CATALOG_API_URL is unset (see ../../catalog/route.ts). Passes
 * through the upstream status as-is, so a backend 404 becomes a 404 here.
 */

import { NextResponse } from 'next/server'
import { env } from '@/lib/env'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, ctx: { params: Promise<{ key: string }> }) {
  const base = env.CATALOG_API_URL?.replace(/\/+$/, '')
  if (!base) {
    return NextResponse.json({ error: 'CATALOG_API_URL not configured' }, { status: 503 })
  }

  const { key } = await ctx.params
  const target = `${base}/domains/${encodeURIComponent(key)}`

  // Forward the caller's own credentials so the catalog backend enforces
  // per-user permissions instead of trusting every request that reaches this
  // proxy (see src/app/api/node/[...path]/route.ts for the same pattern).
  const headers: Record<string, string> = { accept: 'application/json' }
  const cookie = request.headers.get('cookie')
  if (cookie) headers.cookie = cookie
  const authorization = request.headers.get('authorization')
  if (authorization) headers.authorization = authorization

  try {
    const upstream = await fetch(target, {
      signal: request.signal,
      headers,
    })
    const body = await upstream.text()
    return new NextResponse(body, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    })
  } catch {
    return NextResponse.json({ error: 'catalog backend unreachable' }, { status: 502 })
  }
}
