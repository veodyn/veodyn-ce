import { notFound, relayChatJson } from '@/lib/chat/relay'
import { threadListSchema, threadSchema } from '@/lib/chat/wire'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const offset = new URL(request.url).searchParams.get('offset') ?? '0'
  if (!/^\d{1,6}$/.test(offset)) return notFound()
  return relayChatJson(request, { method: 'GET', path: `threads?offset=${offset}`, responseSchema: threadListSchema })
}

export async function POST(request: Request) {
  return relayChatJson(request, { method: 'POST', path: 'threads', responseSchema: threadSchema })
}
