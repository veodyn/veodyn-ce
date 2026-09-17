import { NextResponse } from 'next/server'
import { forwardedHeaders, sidecarBase } from '@/app/api/published-feeds/forward'

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
    return NextResponse.json({ error: 'connector backend unreachable' }, { status: 502 })
  }
}
