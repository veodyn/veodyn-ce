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
import { normalizePublicVisualization } from '@/lib/public-visualization'
import { readerForwardingHeaders } from '@/lib/reader-forwarding'

export const dynamic = 'force-dynamic'

const NOT_FOUND = {
  error: 'visualization not available',
  errorId: ErrorIds.API_NOT_FOUND,
}

export async function GET(request: Request, ctx: { params: Promise<{ token: string }> }) {
  const base = env.REDASH_URL.replace(/\/+$/, '')
  if (!base) {
    return NextResponse.json(
      { error: 'REDASH_URL not configured', errorId: ErrorIds.CFG_ENV_MISSING },
      { status: 503 }
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
    // Upstream's own body is not passed through even on a refusal: it is
    // written for an authenticated API caller and may name the object. The
    // reader gets one sentence and a status.
    if (!upstream.ok) return NextResponse.json(NOT_FOUND, { status: 404 })

    const payload = normalizePublicVisualization(await upstream.json())
    if (!payload) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json(payload)
  } catch {
    return NextResponse.json(
      { error: 'redash backend unreachable', errorId: ErrorIds.UP_UNREACHABLE },
      { status: 502 }
    )
  }
}
