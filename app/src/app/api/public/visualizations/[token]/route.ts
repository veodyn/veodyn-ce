// The one unauthenticated visualization route, and the embed equivalent of
// api/public/reports/[token]. The token in the path is the entire credential,
// so nothing here forwards a cookie or a key: doing so would let a signed-in
// author's session decide what an anonymous reader sees.
//
// Every failure answers 404 with the same body. Redash already refuses a
// revoked, expired and never-issued token identically, and telling the two
// apart out here would rebuild the probing oracle that rule exists to close.
import { NextResponse } from 'next/server'
import { forwardPublicVisualization } from '@/app/api/public/forward-public-visualization'
import { PUBLIC_CORS_HEADERS } from './cors'

export const dynamic = 'force-dynamic'

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_CORS_HEADERS })
}

export async function GET(request: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  return forwardPublicVisualization(request, `/api/visualizations/public/${encodeURIComponent(token)}`)
}
