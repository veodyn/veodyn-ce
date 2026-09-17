import { NextResponse } from 'next/server'
import { forwardedHeaders, sidecarBase } from '@/app/api/published-feeds/forward'
import { config } from '@/lib/config'
import { ErrorIds } from '@/lib/errorIds'

export async function forward(request: Request, path: string, init?: RequestInit) {
  if (!config.connectors.enabled) {
    return NextResponse.json(
      { error: 'connectors are switched off for this instance', errorId: ErrorIds.API_NOT_FOUND },
      { status: 404 }
    )
  }
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
    return NextResponse.json({ error: 'connector backend unreachable' }, { status: 502 })
  }
}
