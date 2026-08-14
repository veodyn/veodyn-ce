// The public feed proxy: the anonymous read `feed-address.tsx` promises at
// `/api/public/feeds/<slug>`, made real. `feedPath()` in that component is
// the one place the path string is written; this route is what makes it
// answer instead of 404 at the framework.
//
// Same shape as api/public/visualizations/[token]/route.ts, the app's other
// unauthenticated public route: no credential forwarded, upstream body never
// passed through on a refusal, one identical 404 for every cause. No cookie,
// no authorization: this endpoint is anonymous by design, and forwarding a
// signed-in author's session would let their identity decide what an
// anonymous reader sees. Do NOT reach for ../../../published-feeds/forward.ts
// beyond its sidecarBase() helper: forwardedHeaders() there attaches the
// caller's cookie and authorization, which is exactly wrong here, and its
// body handling reads the upstream with .text(), which corrupts the
// protobuf bytes this endpoint serves.

import { NextResponse } from 'next/server'
import { ErrorIds } from '@/lib/errorIds'
import { readerForwardingHeaders } from '@/lib/reader-forwarding'
import { sidecarBase } from '@/app/api/published-feeds/forward'

export const dynamic = 'force-dynamic'

const GTFS_RT_CONTENT_TYPE = 'application/x-protobuf'

const NOT_FOUND = {
  error: 'feed not available',
  errorId: ErrorIds.API_NOT_FOUND,
}

export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const base = sidecarBase()
  if (!base) {
    return NextResponse.json({ error: 'no sidecar URL configured' }, { status: 503 })
  }

  const { slug } = await ctx.params
  try {
    const upstream = await fetch(`${base}/public/feeds/${encodeURIComponent(slug)}`, {
      signal: request.signal,
      headers: readerForwardingHeaders(request),
    })
    // Upstream's own body is not passed through, even on a refusal: routers/
    // public_feeds.py answers the identical 404 for an unknown slug, a private
    // feed, and a never-published one on purpose, and this proxy holds that
    // line rather than adding a second place a cause could leak through.
    if (upstream.status === 404) return NextResponse.json(NOT_FOUND, { status: 404 })
    // Anything else is the backend failing, not a feed being absent, and the
    // two must not answer alike. Collapsing a 500 or a 503 into 404 tells every
    // consumer and every monitor that the feed went away, which is the one
    // reading that makes an outage look like a deliberate unpublish.
    //
    // It costs no secrecy. The identical-404 rule exists so nobody can learn
    // which slugs exist by comparing responses, and a backend that is down
    // answers this way for every slug, known or invented, so it separates
    // nothing.
    if (!upstream.ok) {
      return NextResponse.json(
        { error: 'published feed backend failed', errorId: ErrorIds.UP_UNREACHABLE },
        { status: 502 }
      )
    }

    const bytes = await upstream.arrayBuffer()
    return new NextResponse(bytes, { status: 200, headers: { 'content-type': GTFS_RT_CONTENT_TYPE } })
  } catch {
    return NextResponse.json(
      { error: 'published feed backend unreachable', errorId: ErrorIds.UP_UNREACHABLE },
      { status: 502 }
    )
  }
}
