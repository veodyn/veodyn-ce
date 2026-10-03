// The one unauthenticated visualization route, and the embed equivalent of
// api/public/reports/[token]. The token in the path is the entire credential,
// so nothing here forwards a cookie or a key: doing so would let a signed-in
// author's session decide what an anonymous reader sees.
//
// Every failure answers 404 with the same body. Redash already refuses a
// revoked, expired and never-issued token identically, and telling the two
// apart out here would rebuild the probing oracle that rule exists to close.
import { NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { ErrorIds } from '@/lib/errorIds'
import { normalizePublicVisualization } from '@veodyn/viz/normalize'
import { readerForwardingHeaders } from '@/lib/reader-forwarding'
import { PUBLIC_CORS_HEADERS } from './cors'

export const dynamic = 'force-dynamic'

const NOT_FOUND = {
  error: 'visualization not available',
  errorId: ErrorIds.API_NOT_FOUND,
}

const UNAVAILABLE = {
  error: 'redash backend unavailable',
  errorId: ErrorIds.UP_UNREACHABLE,
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_CORS_HEADERS })
}

export async function GET(request: Request, ctx: { params: Promise<{ token: string }> }) {
  const base = env.REDASH_URL.replace(/\/+$/, '')
  if (!base) {
    return NextResponse.json(
      { error: 'REDASH_URL not configured', errorId: ErrorIds.CFG_ENV_MISSING },
      { status: 503, headers: PUBLIC_CORS_HEADERS }
    )
  }

  const { token } = await ctx.params
  try {
    const upstream = await fetch(
      `${base}/api/visualizations/public/${encodeURIComponent(token)}`,
      {
        signal: request.signal,
        headers: { accept: 'application/json', ...readerForwardingHeaders(request) },
      }
    )
    if (upstream.status >= 500 || upstream.status === 429) {
      return NextResponse.json(UNAVAILABLE, { status: 502, headers: PUBLIC_CORS_HEADERS })
    }
    if (!upstream.ok) return NextResponse.json(NOT_FOUND, { status: 404, headers: PUBLIC_CORS_HEADERS })

    const payload = normalizePublicVisualization(await upstream.json())
    if (!payload) return NextResponse.json(NOT_FOUND, { status: 404, headers: PUBLIC_CORS_HEADERS })
    return NextResponse.json(payload, { headers: PUBLIC_CORS_HEADERS })
  } catch {
    return NextResponse.json(
      { error: 'redash backend unreachable', errorId: ErrorIds.UP_UNREACHABLE },
      { status: 502, headers: PUBLIC_CORS_HEADERS }
    )
  }
}
