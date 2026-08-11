/**
 * Same-origin proxy for the sidecar's tag endpoints.
 *
 *   GET /api/tags                     -> <veodyn-api>/tags        (vocabulary)
 *   PUT /api/tags/{type}/{id}         -> <veodyn-api>/tags/{type}/{id}
 *
 * An OPTIONAL catch-all, because one handler has to serve both the bare
 * `/api/tags` vocabulary and the two-segment write path. A required `[...path]`
 * would 404 the vocabulary.
 *
 * 503s when no veodyn-api base is configured, matching /api/kpis and
 * /api/catalog: that is the agreed "not wired yet" signal, and the UI hides the
 * editing affordance on it rather than showing a control that always fails.
 */

import { NextResponse } from 'next/server'
import { env } from '@/lib/env'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ path?: string[] }>
}

/**
 * The veodyn-api base, from whichever of its three aliases is set.
 *
 * KPI_API_URL, CATALOG_API_URL and REPORTS_API_URL are three names for ONE
 * service: veodyn-api serves /kpis, /catalog, /reports and now /tags off the
 * same root. They exist separately because each contract was wired up on its
 * own schedule and could in principle be split out later, not because they
 * point anywhere different today. Deployments reflect that: frontend-dev sets
 * all three to the same host, and frontend-prod sets only CATALOG_API_URL. So
 * reading one var alone leaves /api/tags dead in production, with every Add Tag
 * affordance hidden because the probe sees a 503.
 *
 * Null only when NONE of them is set, which is the genuine "not configured"
 * signal the UI depends on.
 */
function base(): string | null {
  const configured = env.KPI_API_URL || env.CATALOG_API_URL || env.REPORTS_API_URL
  return configured?.replace(/\/+$/, '') || null
}

function forwardHeaders(request: Request): Record<string, string> {
  // Forward the caller's own credentials so the backend enforces per-user and
  // per-org permissions instead of trusting everything that reaches this proxy.
  const headers: Record<string, string> = { accept: 'application/json' }
  const cookie = request.headers.get('cookie')
  if (cookie) headers.cookie = cookie
  const authorization = request.headers.get('authorization')
  if (authorization) headers.authorization = authorization
  return headers
}

/**
 * The path segments are caller input, so they are not forwarded blind: a `.` or
 * `..` segment would let a request addressed to /api/tags reach a sibling
 * endpoint on the backend.
 */
function buildTarget(b: string, segments: string[], request: Request): string | null {
  if (segments.some((s) => !s || s === '.' || s === '..')) return null
  const suffix = segments.map(encodeURIComponent).join('/')
  const target = new URL(`${b}/tags${suffix ? `/${suffix}` : ''}`)
  const incoming = new URL(request.url).searchParams
  for (const [key, value] of incoming) target.searchParams.append(key, value)
  return target.toString()
}

async function relay(request: Request, context: RouteContext, method: 'GET' | 'PUT') {
  const b = base()
  if (!b) {
    return NextResponse.json(
      { error: 'veodyn-api not configured (set KPI_API_URL, CATALOG_API_URL or REPORTS_API_URL)' },
      { status: 503 }
    )
  }

  const { path } = await context.params
  const target = buildTarget(b, path ?? [], request)
  if (!target) return NextResponse.json({ error: 'invalid tag path' }, { status: 400 })

  const init: RequestInit = { method, signal: request.signal, headers: forwardHeaders(request) }
  if (method === 'PUT') {
    init.body = await request.text()
    init.headers = { ...forwardHeaders(request), 'content-type': 'application/json' }
  }

  try {
    const upstream = await fetch(target, init)
    const body = await upstream.text()
    return new NextResponse(body, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    })
  } catch {
    return NextResponse.json({ error: 'tag backend unreachable' }, { status: 502 })
  }
}

export async function GET(request: Request, context: RouteContext) {
  return relay(request, context, 'GET')
}

export async function PUT(request: Request, context: RouteContext) {
  return relay(request, context, 'PUT')
}
