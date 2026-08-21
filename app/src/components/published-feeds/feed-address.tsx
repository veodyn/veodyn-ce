'use client'

import { useSyncExternalStore } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { InputWithCopy } from '@/components/shared/input-with-copy'
import { Slot } from '@/features/slots'
import { SUBSECTION_HEADING } from '@/lib/section-heading'
import type { PublishedFeed } from '@/types/published-feed'

// The address a consumer reads the feed at, which is the one thing on this
// page an operator hands to somebody else.
//
// Deliberately NOT a live link. The endpoint that answers here ships in the
// enterprise pack, and a community deployment runs no publisher at all, so a
// page rendering this as a working URL would be right in one build and wrong
// in the other with nothing on screen to tell them apart. It is the feed's
// declared address, and the line under it says what has to be true for
// anything to answer.

/** What the server renders, since it has no origin to read. */
const PLACEHOLDER_ORIGIN = 'https://your-instance.example'

/** Where the enterprise serving endpoint answers. Kept next to the copy that shows it. */
export function feedPath(slug: string): string {
  return `/api/public/feeds/${encodeURIComponent(slug)}`
}

// The origin is an external system, not React state, so it is read through
// useSyncExternalStore with its own server snapshot rather than assigned in an
// effect. That keeps the first paint identical on both sides of hydration
// without a cascading render, which `react-hooks/set-state-in-effect` refuses.
const subscribe = () => () => {}
const readOrigin = () => window.location.origin
const serverOrigin = () => PLACEHOLDER_ORIGIN

export function FeedAddress({ feed }: { feed: PublishedFeed }) {
  const origin = useSyncExternalStore(subscribe, readOrigin, serverOrigin)

  return (
    <Card>
      <CardContent className="space-y-2">
        <h2 className={SUBSECTION_HEADING}>Address</h2>
        {feed.visibility === 'public' ? (
          <>
            <InputWithCopy label="Feed address" value={`${origin}${feedPath(feed.slug)}`} />
            <p className="text-sm text-muted-foreground">
              Anyone can read the feed here, with no credential. It answers once an attempt has
              published, and where a publisher is deployed.
            </p>
          </>
        ) : (
          <>
            {/* No address at all rather than one that refuses. Nothing here
                issues a token, so a community build has none to hand out and
                printing a URL would send someone looking for one. */}
            <p className="text-sm text-muted-foreground">
              This feed is private, so it has no public address. Reaching a private feed takes an
              issued token, and issuing them ships with the enterprise pack. The panel below
              appears once that pack is installed.
            </p>
            {/* The seam for the enterprise pack's token panel, which is what
                actually makes the paragraph above obsolete once it exists. A
                community build renders nothing here, same as any other
                unfilled slot. */}
            <Slot id="publishedFeed.tokenPanel" props={{ slug: feed.slug }} fallback={null} />
          </>
        )}
      </CardContent>
    </Card>
  )
}
