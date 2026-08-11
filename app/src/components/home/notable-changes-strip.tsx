'use client'

// Home's non-AI insight surface (demo scenario a).
//
// The section is the community edition's; its contents are the
// `home.notableChanges` slot's. With the KPI feature installed the slot renders
// the full strip: movers read off live KPI evaluations, freshness, and recent
// threshold breaches. With nothing installed, this file renders what the
// community can compute on its own, which is freshness.
//
// The whole section is the slot rather than one column of it, because a mover's
// value, delta and direction come from the KPI behind the counter, not from the
// counter. Composing a community movers group with an enterprise one would show
// the same metric twice with two different numbers, which is exactly what a
// "notable changes" strip must never do.
//
// Datasets, not feeds: these cards come from useCatalog and link to
// /data/dataset/:id. A feed is a separate resource behind useFeeds, which is
// what /feed-health reports on, and one word for two resources reads as a
// contradiction between the two pages.
import Link from 'next/link'
import { useCatalog } from '@/hooks/use-catalog'
import { Slot } from '@/features/slots'
import { FreshnessBadge } from '@/components/catalog/freshness-badge'
import { computeFreshestStalest } from '@/lib/notable-changes'
import { MICRO_LABEL, MICRO_SUBLABEL } from '@/lib/section-heading'

const CARD_LINK_CLASS =
  'block rounded-lg border bg-card p-3 transition-colors hover:bg-muted/50'
// The strip's own label is MICRO_LABEL; these are the rungs nested inside it,
// and the weight is what separates the two. See lib/section-heading.ts.
const SUB_HEADING_CLASS = `mb-2 ${MICRO_SUBLABEL}`

/**
 * Freshness on its own: one group, so no evenGridColumns call. Renders nothing
 * when the catalog is empty, so Home never shows an empty shell.
 */
function CommunityNotableChanges() {
  const { data: datasets } = useCatalog()
  const { freshest, stalest } = computeFreshestStalest(datasets ?? [])

  if (!freshest) return null

  const showStalest = stalest !== null && stalest.id !== freshest.id

  return (
    <section className="mb-10">
      <h2 className={`mb-3 ${MICRO_LABEL}`}>
        Notable changes
      </h2>
      <div className="grid grid-cols-1 gap-6">
        <div>
          <h3 className={SUB_HEADING_CLASS}>Freshness</h3>
          <div className="flex flex-col gap-3">
            <Link
              href={`/data/dataset/${freshest.id}`}
              className={`${CARD_LINK_CLASS} flex items-center justify-between gap-2`}
            >
              <span className="text-sm">{freshest.name}</span>
              <FreshnessBadge freshness={freshest.freshness} />
            </Link>
            {showStalest && stalest && (
              <Link
                href={`/data/dataset/${stalest.id}`}
                className={`${CARD_LINK_CLASS} flex items-center justify-between gap-2`}
              >
                <span className="text-sm">{stalest.name}</span>
                <FreshnessBadge freshness={stalest.freshness} />
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

export function NotableChangesStrip() {
  return (
    <Slot id="home.notableChanges" props={{}} fallback={<CommunityNotableChanges />} />
  )
}
