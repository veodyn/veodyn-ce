import { chatId, notFound, relayChatJson } from '@/lib/chat/relay'
import { vizCatalog } from '@/lib/chat/viz-catalog'
import { turnRequestSchema, turnStartedSchema } from '@/lib/chat/wire'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = chatId((await ctx.params).id)
  if (!id) return notFound()
  return relayChatJson(request, {
    method: 'POST',
    path: `threads/${id}/turns`,
    requestSchema: turnRequestSchema,
    responseSchema: turnStartedSchema,
    // Which shapes this image can draw, including any the installed packs add.
    // Computed here rather than sent by the browser: see lib/chat/viz-catalog.ts.
    extend: () => ({ vizCatalog: vizCatalog() }),
  })
}
