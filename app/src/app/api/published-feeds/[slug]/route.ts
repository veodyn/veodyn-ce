/** One binding: read, replace, retire. See ../forward.ts for the forwarding rules. */

import { forward } from '../forward'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ slug: string }> }

export async function GET(request: Request, ctx: Ctx) {
  const { slug } = await ctx.params
  return forward(request, `/published-feeds/${encodeURIComponent(slug)}`)
}

export async function PUT(request: Request, ctx: Ctx) {
  const { slug } = await ctx.params
  const body = await request.text()
  return forward(request, `/published-feeds/${encodeURIComponent(slug)}`, {
    method: 'PUT',
    body,
    headers: { 'content-type': 'application/json' },
  })
}

export async function DELETE(request: Request, ctx: Ctx) {
  const { slug } = await ctx.params
  return forward(request, `/published-feeds/${encodeURIComponent(slug)}`, { method: 'DELETE' })
}
