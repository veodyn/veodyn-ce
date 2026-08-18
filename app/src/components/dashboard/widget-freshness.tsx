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
 * TWO DIFFERENT AGES. The text is when this widget's query last RAN, which is
 * what the Refresh control beside it changes; the icon is how old the DATA
 * underneath is, because a query against a dead feed reruns happily and returns
 * a frozen answer. The tooltip names which is which.
 *
 * The verdict comes from `resolveDatasetStatus`, the same path the catalog, Feed
 * Health and the KPI badges use, so this cannot become a second definition of
 * stale that disagrees with them.
 *
 * Fails closed: a widget whose query resolves to no catalog dataset gets a bare
 * timestamp and NO icon.
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
    // Untraceable to a dataset: the age of the run is all that is known.
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
