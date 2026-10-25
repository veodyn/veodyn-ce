import { NextResponse } from 'next/server'
import { normalizePublicParameterValues } from '@veodyn/viz/normalize'
import {
  fetchPublicUpstream,
  publicBackendBase,
  publicBackendMissing,
  publicNotFound,
  publicUnavailable,
  publicUnreachable,
  withRetryAfter,
} from '@/app/api/public/forward-public-visualization'
import { PUBLIC_CORS_HEADERS } from '@/app/api/public/visualizations/[token]/cors'

export const dynamic = 'force-dynamic'

const WIDGET_ID = /^[1-9][0-9]{0,17}$/
const PARAMETER_NAME = /^[A-Za-z0-9_]{1,64}$/
const MAX_PREFIX_LENGTH = 200

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_CORS_HEADERS })
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ token: string; widgetId: string; name: string }> }
) {
  if (!publicBackendBase()) return publicBackendMissing()

  const { token, widgetId, name } = await ctx.params
  const prefix = new URL(request.url).searchParams.get('q') ?? ''
  if (!WIDGET_ID.test(widgetId) || !PARAMETER_NAME.test(name) || prefix.length > MAX_PREFIX_LENGTH) {
    return publicNotFound()
  }
  const search = prefix === '' ? '' : `?q=${encodeURIComponent(prefix)}`
  try {
    const upstream = await fetchPublicUpstream(
      request,
      `/api/dashboards/public/${encodeURIComponent(token)}/widgets/${widgetId}/parameters/${name}/values${search}`
    )
    if (upstream.status === 503) {
      return NextResponse.json({ values: [], truncated: false }, { status: 503, headers: withRetryAfter(upstream) })
    }
    if (upstream.status >= 500 || upstream.status === 429) return publicUnavailable()
    if (!upstream.ok) return publicNotFound()

    const payload = normalizePublicParameterValues(await upstream.json())
    if (!payload) return publicNotFound()
    return NextResponse.json(payload, { status: 200, headers: PUBLIC_CORS_HEADERS })
  } catch {
    return publicUnreachable()
  }
}
