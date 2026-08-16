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

/** What routers/public_feeds.py answers when a `last_good` feed is past its cap. */
const TOO_STALE_ID = 'VEODYN_PUBLIC_FEED_TOO_STALE'

/**
 * Whether a 503 is the sidecar withholding a stale feed, as opposed to any of
 * the other things that answer 503: an ingress with no healthy backend, a pod
 * restarting, a proxy in front of either.
 *
 * Reads and discards the body, which is safe here because this route never
 * passes an upstream body through. Anything unparseable is not the refusal we
 * are looking for: an ingress answers HTML, and treating that as a stale feed
 * would advertise an outage as a healthy feed waiting for fresh data.
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
    // Upstream's own body is not passed through, even on a refusal: routers/
    // public_feeds.py answers the identical 404 for an unknown slug, a private
    // feed, and a never-published one on purpose, and this proxy holds that
    // line rather than adding a second place a cause could leak through.
    if (upstream.status === 404) return NextResponse.json(NOT_FOUND, { status: 404 })
    // A feed in `last_good` mode whose artifact is past its age cap. Passed
    // through as a 503 with its Retry-After rather than folded into the 502
    // below, because it is the one refusal here that is neither an absence nor
    // a fault: the operator asked for it, and a consumer's correct response is
    // to poll again rather than to alert or to give up on the address.
    //
    // Matched on the error ID, NOT on the status alone. A 503 is also what an
    // ingress or a restarting sidecar answers, and calling that "stale" would
    // tell every consumer to keep polling through a real outage, which is the
    // same mistake as the 404 collapse below in the other direction.
    //
    // Upstream's message is still not repeated, for the same reason as the
    // 404: this proxy says what a reader can act on and nothing about which
    // feed it was.
    if (upstream.status === 503 && (await isStaleFeedRefusal(upstream))) {
      const retryAfter = upstream.headers.get('retry-after')
      return NextResponse.json(
        { error: 'feed temporarily stale', errorId: ErrorIds.API_FEED_TOO_STALE },
        { status: 503, ...(retryAfter ? { headers: { 'retry-after': retryAfter } } : {}) }
      )
    }
    // Anything else is the backend failing, not a feed being absent, and the
    // two must not answer alike. Collapsing a 500 into 404 tells every
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
