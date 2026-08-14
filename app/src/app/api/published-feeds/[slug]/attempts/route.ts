/** The publish record, and the control that adds to it. */

import { forward } from '../../forward'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ slug: string }> }

export async function GET(request: Request, ctx: Ctx) {
  const { slug } = await ctx.params
  return forward(request, `/published-feeds/${encodeURIComponent(slug)}/attempts`)
}

// No body. What to publish is the binding's business, not the caller's.
export async function POST(request: Request, ctx: Ctx) {
  const { slug } = await ctx.params
  return forward(request, `/published-feeds/${encodeURIComponent(slug)}/attempts`, { method: 'POST' })
}
