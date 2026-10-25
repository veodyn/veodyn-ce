import { NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { ErrorIds } from '@/lib/errorIds'
import { normalizePublicVisualization } from '@veodyn/viz/normalize'
import { readerForwardingHeaders } from '@/lib/reader-forwarding'
import { PUBLIC_CORS_HEADERS } from './visualizations/[token]/cors'
import { publicParameterQuery } from './visualizations/[token]/parameters'

const NOT_FOUND = {
  error: 'visualization not available',
  errorId: ErrorIds.API_NOT_FOUND,
}

const UNAVAILABLE = {
  error: 'redash backend unavailable',
  errorId: ErrorIds.UP_UNREACHABLE,
}

export function publicNotFound(): NextResponse {
  return NextResponse.json(NOT_FOUND, { status: 404, headers: PUBLIC_CORS_HEADERS })
}

export function publicUnavailable(): NextResponse {
  return NextResponse.json(UNAVAILABLE, { status: 502, headers: PUBLIC_CORS_HEADERS })
}

export function publicBackendBase(): string {
  return env.REDASH_URL.replace(/\/+$/, '')
}

export function publicBackendMissing(): NextResponse {
  return NextResponse.json(
    { error: 'REDASH_URL not configured', errorId: ErrorIds.CFG_ENV_MISSING },
    { status: 503, headers: PUBLIC_CORS_HEADERS }
  )
}

export function publicUnreachable(): NextResponse {
  return NextResponse.json(
    { error: 'redash backend unreachable', errorId: ErrorIds.UP_UNREACHABLE },
    { status: 502, headers: PUBLIC_CORS_HEADERS }
  )
}

export function withRetryAfter(upstream: Response): Record<string, string> {
  const retryAfter = upstream.headers.get('retry-after')
  return retryAfter ? { ...PUBLIC_CORS_HEADERS, 'Retry-After': retryAfter } : { ...PUBLIC_CORS_HEADERS }
}

export async function fetchPublicUpstream(request: Request, path: string): Promise<Response> {
  return fetch(`${publicBackendBase()}${path}`, {
    signal: request.signal,
    headers: { accept: 'application/json', ...readerForwardingHeaders(request) },
  })
}

export async function forwardPublicVisualization(request: Request, upstreamPath: string): Promise<NextResponse> {
  if (!publicBackendBase()) return publicBackendMissing()

  const query = publicParameterQuery(new URL(request.url).searchParams)
  if (query === null) return publicNotFound()
  try {
    const upstream = await fetchPublicUpstream(request, `${upstreamPath}${query}`)
    if (upstream.status === 503) {
      const payload = normalizePublicVisualization(await upstream.json())
      if (!payload) return publicUnavailable()
      return NextResponse.json(payload, { status: 503, headers: withRetryAfter(upstream) })
    }
    if (upstream.status >= 500 || upstream.status === 429) return publicUnavailable()
    if (!upstream.ok) return publicNotFound()

    const payload = normalizePublicVisualization(await upstream.json())
    if (!payload) return publicNotFound()
    return NextResponse.json(payload, { status: upstream.status === 202 ? 202 : 200, headers: withRetryAfter(upstream) })
  } catch {
    return publicUnreachable()
  }
}
