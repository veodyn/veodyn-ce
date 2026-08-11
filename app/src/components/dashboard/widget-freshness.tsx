'use client'

import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { useCatalog } from '@/hooks/use-catalog'
import { useFeeds } from '@/hooks/use-feeds'
import { useQuerySqlById } from '@/hooks/use-query-sql'
import { datasetForQueryId, resolveDatasetStatus } from '@/lib/dataset-freshness'
import { FEED_STATUS_META } from '@/lib/feed-status'
import { formatRelativeTime } from '@/lib/chart-format'

/**
 * A widget's data age, with a status icon that means something.
 *
 * This used to be an unconditional green check beside the age. Not a freshness
 * verdict at all: it was drawn whenever a result existed, so two widgets on the
 * same dashboard, one refreshed an hour ago and one six days old, rendered
 * identically. The source said as much ("this reflects data presence only"),
 * which made it honest in the code and not at all honest on screen.
 *
 * What made it worse than an unfinished feature is the vocabulary it borrowed.
 * `FEED_STATUS_META` defines the product's freshness language, and Fresh is
 * `text-status-fresh` plus a check icon. The widget used exactly that signal,
 * applied to everything, so a reader who had learned green-check-means-fresh
 * from the catalog, Feed Health or a KPI badge read it the same way here and was
 * wrong. Dashboards are the product's watching surface, which is where
 * per-widget staleness matters most.
 *
 * The verdict now comes from `resolveDatasetStatus`, the same path the catalog,
 * Feed Health and the KPI badges use, so a stale feed turns the check into a
 * warning triangle here as well rather than this being a second definition of
 * stale that could disagree with them.
 *
 * TWO DIFFERENT AGES, and the distinction is the whole point. The text is when
 * this widget's query last RAN, because that is what the Refresh control beside
 * it changes. The icon is how old the DATA underneath is. A query against a dead
 * feed reruns happily every hour and returns a frozen answer, which is precisely
 * the trap `dataset-freshness.ts` was written for. The tooltip names which is which,
 * because an icon and a timestamp sitting together otherwise read as one claim.
 *
 * Fails closed. A widget whose query resolves to no catalog dataset gets a bare
 * timestamp and NO icon: claiming nothing beats claiming freshness nothing
 * supports, and it is the same choice the KPI badge makes when it cannot trace a
 * KPI to a dataset.
 */
export function WidgetFreshness({
  queryId,
  retrievedAt,
  now,
}: {
  queryId: number
  retrievedAt: string | undefined
  /** Milliseconds since epoch, ticked by the parent; null before mount. */
  now: number | null
}) {
  // All three are shared react-query caches, so the widgets on a dashboard cost
  // one request between them rather than one each.
  const { data: datasets } = useCatalog()
  const { data: feeds } = useFeeds()
  // The edge is the table this widget's query reads, so resolving it needs SQL.
  const sqlByQueryId = useQuerySqlById()

  if (now == null) return null

  const ran = formatRelativeTime(retrievedAt, now)
  const dataset = datasetForQueryId(queryId, datasets, sqlByQueryId)
  const status = dataset ? resolveDatasetStatus(dataset.freshness, feeds, now) : null

  if (!status) {
    // Untraceable to a dataset: the age of the run is all that is known, so it
    // is all that is shown.
    return (
      <span className="mr-1 font-mono text-xs tabular-nums text-muted-foreground">{ran}</span>
    )
  }

  const { label, Icon, text } = FEED_STATUS_META[status]

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className={`mr-1 inline-flex items-center gap-1 font-mono text-xs tabular-nums ${text}`} />
        }
      >
        <Icon className="h-3 w-3" />
        {ran}
      </TooltipTrigger>
      <TooltipContent>
        Underlying data: {label}. Last run {ran}.
      </TooltipContent>
    </Tooltip>
  )
}
