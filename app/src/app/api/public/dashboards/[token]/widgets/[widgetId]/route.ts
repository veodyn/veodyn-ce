import { NextResponse } from 'next/server'
import { forwardPublicVisualization, publicNotFound } from '@/app/api/public/forward-public-visualization'
import { PUBLIC_CORS_HEADERS } from '@/app/api/public/visualizations/[token]/cors'

export const dynamic = 'force-dynamic'

const WIDGET_ID = /^[1-9][0-9]{0,17}$/

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_CORS_HEADERS })
}

export async function GET(request: Request, ctx: { params: Promise<{ token: string; widgetId: string }> }) {
  const { token, widgetId } = await ctx.params
  if (!WIDGET_ID.test(widgetId)) return publicNotFound()
  return forwardPublicVisualization(
    request,
    `/api/dashboards/public/${encodeURIComponent(token)}/widgets/${widgetId}`
  )
}
