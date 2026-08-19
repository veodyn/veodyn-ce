'use client'

import { Badge } from '@/components/ui/badge'
import { TimeAgo } from '@/components/shared/time-ago'
import { useCaptures } from '@/hooks/use-captures'
import { useNow } from '@/hooks/use-now'
import { resolveDatasetStatus } from '@/lib/dataset-freshness'
import { CAPTURE_STATUS_META } from '@/lib/capture-status'
import type { DatasetFreshness } from '@/types/catalog'

export function FreshnessBadge({ freshness }: { freshness: DatasetFreshness }) {
  // Shared react-query cache, so the several badges on a catalog page cost one
  // request between them.
  const { data: captures } = useCaptures()
  // Ticks, because the verdict is a function of elapsed time: without it a badge
  // sat on whichever status was true when it mounted.
  const clock = useNow()
  // Zero is the server and hydrating render, where there is no clock to age
  // against, so the declared status stands until the store's first read. Reading
  // Date.now() here instead would be an impure render and a hydration mismatch.
  const status = clock === 0 ? freshness.status : resolveDatasetStatus(freshness, captures, clock)
  // Shared with the Feed Health board, which renders the same three statuses in
  // its own bare form. `down` used to be missing from this side's copy.
  const { label, Icon, badge } = CAPTURE_STATUS_META[status]

  return (
    <Badge variant="outline" className={badge}>
      <Icon />
      {/* The status word carries the near-black ink token, not the status
          color, so it clears WCAG AA contrast on the tinted background. The
          icon and border still carry the status color, so the signal is
          still conveyed by icon + word + color together, never color alone. */}
      <span className="text-foreground">{label}</span>
      <TimeAgo
        date={freshness.lastUpdatedAt}
        className="font-mono text-xs tabular-nums text-muted-foreground"
      />
    </Badge>
  )
}
