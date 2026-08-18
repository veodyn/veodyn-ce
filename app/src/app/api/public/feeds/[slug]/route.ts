// The public feed proxy: the anonymous read `feed-address.tsx` promises at
// `/api/public/feeds/<slug>` (its `feedPath()` writes the path string).
//
// Same shape as api/public/visualizations/[token]/route.ts: no credential
// forwarded, upstream body never passed through on a refusal, one identical 404
// for every cause. Forwarding a signed-in author's cookie would let their
// identity decide what an anonymous reader sees.
//
// Do NOT reach for ../../../published-feeds/forward.ts beyond sidecarBase():
// its forwardedHeaders() attaches the caller's cookie and authorization, and
// its body handling reads the upstream with .text(), which corrupts protobuf.

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

/** What routers/public_feeds.py answers when a `last_good` feed is past its cap. */
const TOO_STALE_ID = 'VEODYN_PUBLIC_FEED_TOO_STALE'

/**
 * Whether a 503 is the sidecar withholding a stale feed rather than an ingress
 * with no healthy backend or a restarting pod. Reading the body is safe because
 * this route never passes an upstream body through, and anything unparseable
 * (an ingress answers HTML) is not the refusal being looked for.
 */
async function isStaleFeedRefusal(upstream: Response): Promise<boolean> {
  try {
    const body = (await upstream.json()) as { error?: { id?: string } }
    return body?.error?.id === TOO_STALE_ID
  } catch {
    return false
  }
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
    // routers/public_feeds.py answers the identical 404 for an unknown slug, a
    // private feed and a never-published one, so no upstream body is passed
    // through here either.
    if (upstream.status === 404) return NextResponse.json(NOT_FOUND, { status: 404 })
    // A feed in `last_good` mode past its age cap: kept as a 503 with its
    // Retry-After rather than folded into the 502, because the correct consumer
    // response is to poll again. Matched on the error ID, NOT the status alone,
    // since an ingress or a restarting sidecar also answers 503 and calling
    // that "stale" tells consumers to poll through a real outage.
    if (upstream.status === 503 && (await isStaleFeedRefusal(upstream))) {
      const retryAfter = upstream.headers.get('retry-after')
      return NextResponse.json(
        { error: 'feed temporarily stale', errorId: ErrorIds.API_FEED_TOO_STALE },
        { status: 503, ...(retryAfter ? { headers: { 'retry-after': retryAfter } } : {}) }
      )
    }
    // Anything else is the backend failing, not a feed being absent: collapsing
    // it into a 404 would tell every consumer and monitor the feed went away.
    // It leaks nothing, because a backend that is down answers this way for
    // every slug, known or invented.
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
