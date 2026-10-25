import { NextResponse } from 'next/server'
import { normalizePublicDashboard } from '@veodyn/viz/normalize'
import {
  fetchPublicUpstream,
  publicBackendBase,
  publicBackendMissing,
  publicNotFound,
  publicUnavailable,
  publicUnreachable,
} from '@/app/api/public/forward-public-visualization'
import { PUBLIC_CORS_HEADERS } from '@/app/api/public/visualizations/[token]/cors'

export const dynamic = 'force-dynamic'

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_CORS_HEADERS })
}

export async function GET(request: Request, ctx: { params: Promise<{ token: string }> }) {
  if (!publicBackendBase()) return publicBackendMissing()

  const { token } = await ctx.params
  try {
    const upstream = await fetchPublicUpstream(request, `/api/dashboards/public/${encodeURIComponent(token)}`)
    if (upstream.status >= 500 || upstream.status === 429) return publicUnavailable()
    if (!upstream.ok) return publicNotFound()

    const payload = normalizePublicDashboard(await upstream.json())
    if (!payload) return publicNotFound()
    return NextResponse.json(payload, { status: 200, headers: PUBLIC_CORS_HEADERS })
  } catch {
    return publicUnreachable()
  }
}
