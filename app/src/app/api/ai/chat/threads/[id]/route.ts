import { chatId, notFound, relayChatJson } from '@/lib/chat/relay'
import { patchThreadSchema, threadDetailSchema, threadSchema } from '@/lib/chat/wire'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

export async function GET(request: Request, ctx: Context) {
  const id = chatId((await ctx.params).id)
  if (!id) return notFound()
  return relayChatJson(request, { method: 'GET', path: `threads/${id}`, responseSchema: threadDetailSchema })
}

export async function PATCH(request: Request, ctx: Context) {
  const id = chatId((await ctx.params).id)
  if (!id) return notFound()
  return relayChatJson(request, {
    method: 'PATCH',
    path: `threads/${id}`,
    requestSchema: patchThreadSchema,
    responseSchema: threadSchema,
  })
}

export async function DELETE(request: Request, ctx: Context) {
  const id = chatId((await ctx.params).id)
  if (!id) return notFound()
  return relayChatJson(request, { method: 'DELETE', path: `threads/${id}` })
}
