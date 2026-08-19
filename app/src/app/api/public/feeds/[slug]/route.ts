// The public feed proxy: the anonymous read `feed-address.tsx` promises at
// `/api/public/feeds/<slug>` (its `feedPath()` writes the path string).
//
// Answers a GTFS-Realtime message for a gtfs-rt feed and the `gbfs.json`
// discovery document for a gbfs one, which is the same promise either way: one
// address to hand a consumer. The member files a discovery document names are
// served by the `[file]` route beneath this one.
//
// Everything about how a refusal is shaped lives in forward-feed.ts, shared
// with that route.

import { forwardFeed } from '../forward-feed'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params
  return forwardFeed(request, encodeURIComponent(slug))
}
