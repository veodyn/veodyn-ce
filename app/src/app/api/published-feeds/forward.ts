/**
 * Same-origin forwarding for the published-feed proxy routes.
 *
 * The base is resolved from three variables rather than one, extending the
 * reason ../favorites/route.ts gives for falling back across two of them
 * (KPI_API_URL then REPORTS_API_URL): helm points every one of these at the
 * same sidecar, so taking only one breaks an instance that happened to
 * configure a different half. CATALOG_API_URL is not in that file's list and
 * leads here, because /feeds next door already uses it.
 *
 * Refusal bodies are passed through untouched. The 422 these endpoints answer
 * names every problem with a column map, and the form puts each one on its own
 * field, so collapsing it into a status code would throw away the diagnostic.
 */

import { NextResponse } from 'next/server'
import { env } from '@/lib/env'

export function sidecarBase(): string | null {
  const url = env.CATALOG_API_URL || env.KPI_API_URL || env.REPORTS_API_URL
  return url?.replace(/\/+$/, '') || null
}

// The caller's own credentials, so the sidecar resolves the same identity
// Redash would and enforces the admin check itself.
export function forwardedHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = { accept: 'application/json' }
  const cookie = request.headers.get('cookie')
  if (cookie) headers.cookie = cookie
  const authorization = request.headers.get('authorization')
  if (authorization) headers.authorization = authorization
  return headers
}

export async function forward(request: Request, path: string, init?: RequestInit) {
  const base = sidecarBase()
  if (!base) {
    return NextResponse.json({ error: 'no sidecar URL configured' }, { status: 503 })
  }
  try {
    const upstream = await fetch(`${base}${path}`, {
      ...init,
      signal: request.signal,
      headers: { ...forwardedHeaders(request), ...(init?.headers as Record<string, string>) },
    })
    const body = await upstream.text()
    if (upstream.status === 204 || body === '') {
      return new NextResponse(null, { status: upstream.status })
    }
    return new NextResponse(body, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    })
  } catch {
    return NextResponse.json({ error: 'published feed backend unreachable' }, { status: 502 })
  }
}
