import { forward } from '../../forward'

export const dynamic = 'force-dynamic'

const FORWARDED_PARAMS = ['kind', 'q', 'limit'] as const

type Ctx = { params: Promise<{ slug: string }> }

export async function GET(request: Request, ctx: Ctx) {
  const { slug } = await ctx.params
  const incoming = new URL(request.url).searchParams
  const forwarded = new URLSearchParams()
  for (const name of FORWARDED_PARAMS) {
    const value = incoming.get(name)
    if (value) forwarded.set(name, value)
  }
  const query = forwarded.toString()
  return forward(request, `/published-feeds/${encodeURIComponent(slug)}/entities${query ? `?${query}` : ''}`)
}
