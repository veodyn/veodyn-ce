import { forward } from '../forward'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ connectorId: string }> }

export async function GET(request: Request, ctx: Ctx) {
  const { connectorId } = await ctx.params
  return forward(request, `/connectors/${encodeURIComponent(connectorId)}`)
}

export async function PUT(request: Request, ctx: Ctx) {
  const { connectorId } = await ctx.params
  const body = await request.text()
  return forward(request, `/connectors/${encodeURIComponent(connectorId)}`, {
    method: 'PUT',
    body,
    headers: { 'content-type': 'application/json' },
  })
}

export async function DELETE(request: Request, ctx: Ctx) {
  const { connectorId } = await ctx.params
  return forward(request, `/connectors/${encodeURIComponent(connectorId)}`, { method: 'DELETE' })
}
