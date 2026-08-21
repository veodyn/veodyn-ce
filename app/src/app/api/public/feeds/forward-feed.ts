// The public feed proxy, shared by the discovery route and the member-file
// route beneath it.
//
// Shared rather than copied because the discipline here is the point and two
// copies drift: one identical 404 for every cause, an upstream body never
// passed through on a refusal, and exactly one credential carried.
//
// That credential is a feed token, which a private feed's consumer presents as
// `?token=` or as `Authorization: Bearer <t>` and which the sidecar resolves.
// Both transports are carried; the reader's session COOKIE is not, and that
// rule is unchanged. A cookie names a signed-in person, and their identity must
// not decide what an anonymous address answers.
//
// Do NOT reach for ../../published-feeds/forward.ts beyond sidecarBase(): its
// forwardedHeaders() attaches the caller's cookie, which is the line above, and
// its body handling reads the upstream with .text(), which corrupts protobuf.

import { NextResponse } from 'next/server'
import { ErrorIds } from '@/lib/errorIds'
import { readerForwardingHeaders } from '@/lib/reader-forwarding'
import { sidecarBase } from '@/app/api/published-feeds/forward'

const GTFS_RT_CONTENT_TYPE = 'application/x-protobuf'
const GBFS_CONTENT_TYPE = 'application/json'

/**
 * The content type this route answers with, chosen from the two it can
 * legitimately serve rather than echoed.
 *
 * An echoed header is same-origin under /api/*, which has no CSP, so an
 * upstream answering `text/html` would have its body RENDERED rather than
 * downloaded, and `nosniff` does not stop a top-level navigation from doing
 * that. Narrowing to an allowlist keeps the gbfs half honest without turning
 * the response into a page.
 */
function servedContentType(upstream: Response): string {
  const declared = upstream.headers.get('content-type') ?? ''
  return declared.split(';')[0].trim().toLowerCase() === GBFS_CONTENT_TYPE
    ? GBFS_CONTENT_TYPE
    : GTFS_RT_CONTENT_TYPE
}

/**
 * The reader's own headers plus the token header, when they sent one.
 *
 * Set only when present. An empty `authorization` is not the same as an absent
 * one to the sidecar, which reads the scheme off whatever arrives.
 */
function feedForwardingHeaders(request: Request): Record<string, string> {
  const headers = readerForwardingHeaders(request)
  const authorization = request.headers.get('authorization')
  if (authorization) headers.authorization = authorization
  return headers
}

/**
 * The one query parameter this proxy carries, re-encoded rather than the
 * inbound query string passed through: forwarding it wholesale would let a
 * caller reach parameters of the sidecar's own that this route never exposed.
 */
function tokenQuery(request: Request): string {
  const token = new URL(request.url).searchParams.get('token')
  return token ? `?token=${encodeURIComponent(token)}` : ''
}

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

/**
 * Forward one read to the sidecar. `path` is already encoded and is appended to
 * `/public/feeds`.
 */
export async function forwardFeed(request: Request, path: string): Promise<NextResponse> {
  const base = sidecarBase()
  if (!base) {
    return NextResponse.json({ error: 'no sidecar URL configured' }, { status: 503 })
  }

  try {
    const upstream = await fetch(`${base}/public/feeds/${path}${tokenQuery(request)}`, {
      signal: request.signal,
      headers: feedForwardingHeaders(request),
    })
    // routers/public_feeds.py answers the identical 404 for an unknown slug, a
    // private feed with no token or a wrong one, a never-published feed and a
    // member file outside the set, so no upstream body is passed through here
    // either.
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
    // Protobuf for a gtfs-rt feed, JSON for every gbfs one. Hardcoding protobuf
    // hands a GBFS consumer a body its parser refuses; echoing the header hands
    // a browser whatever the upstream said. See servedContentType.
    return new NextResponse(bytes, {
      status: 200,
      headers: { 'content-type': servedContentType(upstream) },
    })
  } catch {
    return NextResponse.json(
      { error: 'published feed backend unreachable', errorId: ErrorIds.UP_UNREACHABLE },
      { status: 502 }
    )
  }
}
