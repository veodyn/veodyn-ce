// One member file of a published GBFS feed, at
// `/api/public/feeds/<slug>/<file>`, which is the address the feed's own
// discovery document points every consumer at.
//
// The sidecar decides what exists: a name outside the published set, a gtfs-rt
// feed and an unknown slug all answer the same 404, so the file set cannot be
// enumerated from here. Everything about how a refusal is shaped is shared with
// the discovery route in forward-feed.ts.

import { forwardFeed } from '../../forward-feed'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, ctx: { params: Promise<{ slug: string; file: string }> }) {
  const { slug, file } = await ctx.params
  return forwardFeed(request, `${encodeURIComponent(slug)}/${encodeURIComponent(file)}`)
}
