// The caller's own starred ids, grouped by object kind, from veodyn-api.
//
// The body is relayed verbatim and this file names no kind, because neither
// side of the exchange holds a list of them: veodyn-api answers with one key
// per kind its own registry has registered, and the browser reads them through
// src/features/favorite-kinds.ts, which derives the same set from the installed
// feature descriptors.
//
// Queries and dashboards are NOT here: Redash owns those favorites and the
// existing /api/node proxy already carries them. This route covers only the
// object kinds the sidecar stores.
import { NextResponse } from 'next/server'
import { env } from '@/lib/env'

export const dynamic = 'force-dynamic'

// Either URL, because /favorites answers for both kinds and veodyn-api serves
// all three surfaces from one app: helm points KPI_API_URL and REPORTS_API_URL
// at the same service. Taking only the KPI one would break report favorites on
// an instance that happened to configure just the reports half.
function base(): string | null {
  const url = env.KPI_API_URL || env.REPORTS_API_URL
  return url?.replace(/\/+$/, '') || null
}

// The browser's own credential, forwarded verbatim: a favorite belongs to a
// person, so the sidecar has to resolve the same identity Redash would.
function forwardHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = { accept: 'application/json' }
  const cookie = request.headers.get('cookie')
  if (cookie) headers.cookie = cookie
  const authorization = request.headers.get('authorization')
  if (authorization) headers.authorization = authorization
  return headers
}

export async function GET(request: Request) {
  const b = base()
  if (!b) return NextResponse.json({ error: 'KPI_API_URL not configured' }, { status: 503 })
  try {
    const upstream = await fetch(`${b}/favorites`, {
      signal: request.signal,
      headers: forwardHeaders(request),
    })
    const body = await upstream.text()
    return new NextResponse(body, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    })
  } catch {
    return NextResponse.json({ error: 'kpi backend unreachable' }, { status: 502 })
  }
}
