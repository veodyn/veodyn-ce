import { chatId, notFound, relayChatJson } from '@/lib/chat/relay'
import { promotionPatchRequestSchema, promotionResponseSchema } from '@/lib/chat/wire'

export const dynamic = 'force-dynamic'

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string; promotionId: string }> }) {
  const params = await ctx.params
  const id = chatId(params.id)
  const promotionId = chatId(params.promotionId)
  if (!id || !promotionId) return notFound()
  return relayChatJson(request, {
    method: 'PATCH',
    path: `drafts/${id}/promotions/${promotionId}`,
    requestSchema: promotionPatchRequestSchema,
    responseSchema: promotionResponseSchema,
  })
}
