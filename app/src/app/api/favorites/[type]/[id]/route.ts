// Star and unstar one object of a kind the sidecar owns. POST adds, DELETE
// removes, matching the verbs Redash uses for the two object kinds it owns, so
// the client has one mental model for all of them.
import { NextResponse } from 'next/server'
import { favoritableKinds } from '@/features/favorite-kinds'
import { env } from '@/lib/env'

export const dynamic = 'force-dynamic'

// The closed list, enforced here as well as at the sidecar. A path segment is
// caller input, and this proxy forwards a browser credential: it has no
// business passing an unknown kind through to see what happens.
//
// Derived from the installed features rather than spelled out, so it cannot
// fall behind what this build actually serves. In a build with no feature
// installed it is empty and every write is refused, which is the right answer:
// there is nothing here to star.
const TYPES = new Set(favoritableKinds())

// Either URL, because /favorites answers for both kinds and veodyn-api serves
// all three surfaces from one app: helm points KPI_API_URL and REPORTS_API_URL
// at the same service. Taking only the KPI one would break report favorites on
// an instance that happened to configure just the reports half.
function base(): string | null {
  const url = env.KPI_API_URL || env.REPORTS_API_URL
  return url?.replace(/\/+$/, '') || null
}

function forwardHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = { accept: 'application/json' }
  const cookie = request.headers.get('cookie')
  if (cookie) headers.cookie = cookie
  const authorization = request.headers.get('authorization')
  if (authorization) headers.authorization = authorization
  return headers
}

async function relay(
  request: Request,
  ctx: { params: Promise<{ type: string; id: string }> },
  method: 'POST' | 'DELETE'
) {
  const b = base()
  if (!b) return NextResponse.json({ error: 'KPI_API_URL not configured' }, { status: 503 })
  const { type, id } = await ctx.params
  if (!TYPES.has(type)) {
    return NextResponse.json({ error: 'unknown favorite type' }, { status: 400 })
  }
  try {
    const upstream = await fetch(
      `${b}/favorites/${encodeURIComponent(type)}/${encodeURIComponent(id)}`,
      { method, signal: request.signal, headers: forwardHeaders(request) }
    )
    // 204 is the success case and carries no body. Constructing a Response with
    // a body on a null-body status throws, so pass the status through bare.
    if (upstream.status === 204) return new NextResponse(null, { status: 204 })
    const body = await upstream.text()
    return new NextResponse(body, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    })
  } catch {
    return NextResponse.json({ error: 'kpi backend unreachable' }, { status: 502 })
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ type: string; id: string }> }) {
  return relay(request, ctx, 'POST')
}

export async function DELETE(request: Request, ctx: { params: Promise<{ type: string; id: string }> }) {
  return relay(request, ctx, 'DELETE')
}
