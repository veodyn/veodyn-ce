'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Rss } from 'lucide-react'
import { NoData } from '@/components/ui/no-data'
import { PageHeader } from '@/components/layout/page-header'
import { ItemsTable, type Column } from '@/components/shared/items-table'
import { ListToolbar } from '@/components/shared/list-toolbar'
import { TimeAgo } from '@/components/shared/time-ago'
import { ExpectedIntervalControl } from '@/components/feeds/expected-interval-control'
import { SkeletonCard } from '@/components/ui/skeleton-card'
import { Slot, hasSlotContributor } from '@/features/slots'
import { cn } from '@/lib/utils'
import { deriveFeedStatus, feedStatusBasis, FEED_STATUS_META } from '@/lib/feed-status'
import { matchesSearch } from '@/lib/list-filter'
import { useCatalog } from '@/hooks/use-catalog'
import { useFeeds } from '@/hooks/use-feeds'
import type { Dataset } from '@/types/catalog'
import type { Feed } from '@/types/feed'
import { PageContainer } from '@/components/layout/page-container'

// Status is conveyed by icon + text + a semantic token, never color alone. The
// word and the icon come from FEED_STATUS_META, shared with the catalog's
// FreshnessBadge, which renders the same three statuses as a tinted pill. Those
// two were spelled out separately and had already disagreed once, with `down`
// reachable here and missing there. The bare form keeps `text`, not `badge`:
// there is no tint behind it, so the status colour is safe on the text itself.
function FeedStatus({ status }: { status: Feed['status'] }) {
  const { label, Icon, text } = FEED_STATUS_META[status]
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm font-medium', text)}>
      <Icon className="h-4 w-4" aria-hidden="true" />
      {label}
    </span>
  )
}

/**
 * The Metrics affected column, present only when a feature fills it.
 *
 * The point of the board is that a feed being stale for nine days matters
 * because of what is still being computed from it and presented as current.
 * What is computed from it is a KPI, and KPIs are a feature, so this column
 * asks the registry rather than joining datasets to KPIs itself.
 *
 * The whole COLUMN is gated on there being a contributor, not just its cells.
 * A community build has no metrics to name, and a column of "None" down every
 * row would say the feeds affect nothing, which is a different claim and a
 * false one. Every other column keeps its layout and its empty state exactly as
 * it was; this is the one that has nothing honest to render on its own.
 */
function metricsColumn(datasetsByFeed: Map<string, Dataset[]>): Column<Feed>[] {
  if (!hasSlotContributor('feedHealth.metrics')) return []
  return [
    {
      key: 'metrics',
      title: 'Metrics affected',
      render: (f) => (
        <Slot id="feedHealth.metrics" props={{ datasets: datasetsByFeed.get(f.id) ?? [] }} fallback={null} />
      ),
    },
  ]
}

function buildColumns(datasetsByFeed: Map<string, Dataset[]>): Column<Feed>[] {
  return [
    {
      key: 'name',
      title: 'Feed',
      sortValue: (f) => f.name,
      render: (f) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{f.name}</div>
          <div className="font-mono text-xs text-muted-foreground">{f.source}</div>
        </div>
      ),
    },
    {
      key: 'status',
      title: 'Status',
      // Derived from cadence and last received, not read off the fixture,
      // except when there is no cadence to derive from. That exception used to
      // be invisible, so a verdict nobody had checked looked exactly like one
      // that had been.
      sortValue: (f) => FEED_STATUS_META[deriveFeedStatus(f)].label,
      render: (f) => (
        <div className="flex flex-col gap-0.5">
          <FeedStatus status={deriveFeedStatus(f)} />
          {feedStatusBasis(f) === 'reported' && (
            <span className="text-xs text-muted-foreground">as reported</span>
          )}
        </div>
      ),
    },
    {
      key: 'lastReceived',
      title: 'Last received',
      sortValue: (f) => f.lastReceivedAt,
      render: (f) => (
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          <TimeAgo date={f.lastReceivedAt} />
        </span>
      ),
    },
    {
      key: 'cadence',
      title: 'Cadence',
      sortValue: (f) => f.cadence,
      // A cadence this cannot parse is not a schedule, whatever string the
      // upstream sent. Printing it in the same monospace as a real interval
      // put "not scheduled" next to a Last received of "59 seconds ago" and
      // let it read as a fact about the feed rather than a gap in what is
      // known about it.
      render: (f) => (
        <div className="flex flex-col items-start gap-0.5">
          {feedStatusBasis(f) === 'derived' ? (
            <span className="font-mono text-xs">
              {f.cadence}
              {f.cadenceSource === 'declared' && (
                <span className="ml-1.5 font-sans text-muted-foreground">expected</span>
              )}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              None declared, so age is not checked
            </span>
          )}
          <ExpectedIntervalControl feed={f} />
        </div>
      ),
    },
    {
      key: 'datasets',
      title: 'Datasets',
      // A monitoring row has to lead to the thing it monitors. The count used
      // to be plain text, so a stale feed was a dead end.
      render: (f) => {
        const datasets = datasetsByFeed.get(f.id) ?? []
        if (datasets.length === 0) {
          return <span className="font-mono text-xs tabular-nums text-muted-foreground">0</span>
        }
        return (
          <div className="flex flex-col gap-0.5">
            {datasets.map((d) => (
              <Link
                key={d.id}
                href={`/data/dataset/${d.id}`}
                className="text-xs text-foreground hover:text-primary hover:underline"
              >
                {d.name}
              </Link>
            ))}
          </div>
        )
      },
    },
    ...metricsColumn(datasetsByFeed),
  ]
}

export default function FeedHealthPage() {
  const { data: feeds, isLoading, isError } = useFeeds()
  const { data: datasets } = useCatalog()
  const [search, setSearch] = useState('')

  const datasetsByFeed = new Map<string, Dataset[]>()
  for (const dataset of datasets ?? []) {
    const feedId = dataset.freshness.feedId
    if (!feedId) continue
    const list = datasetsByFeed.get(feedId)
    if (list) list.push(dataset)
    else datasetsByFeed.set(feedId, [dataset])
  }

  const allFeeds = useMemo(() => feeds ?? [], [feeds])
  const visible = useMemo(
    () =>
      allFeeds.filter((feed) =>
        matchesSearch(search, [feed.name, feed.source, feed.cadence, FEED_STATUS_META[deriveFeedStatus(feed)].label])
      ),
    [allFeeds, search]
  )

  return (
    <PageContainer>
      <PageHeader
        title="Feed Health"
        description="Freshness of the instance's upstream data feeds."
      />
      {isLoading ? (
        <SkeletonCard />
      ) : isError ? (
        // The defect this branch exists for was live on stage: /api/feeds
        // answered 404, the error left `feeds` undefined, and the page rendered
        // the calm "No feeds configured." below. A monitoring page that reports
        // its own outage as "nothing to monitor" is the one failure nobody ever
        // files, because it looks like the truth.
        <NoData
          message="Unable to load feed health. The feed service may be unavailable."
          icon={<Rss className="mb-3 h-10 w-10 opacity-50" />}
        />
      ) : (
        <>
          {/* ListToolbar's box is a fixed w-64, and this page had written a
              placeholder describing all four filterable fields, so it was
              truncated mid-word to "Search by feed, source, cadenc". A control
              whose own default text does not fit reads as broken. */}
          <ListToolbar
            search={search}
            onSearchChange={setSearch}
            searchLabel="Search feeds"
            placeholder="Search feeds..."
            count={visible.length}
            noun="feed"
          />
          <div className="rounded-lg border bg-card">
            <ItemsTable
              columns={buildColumns(datasetsByFeed)}
              items={visible}
              rowKey={(f) => f.id}
              emptyMessage={
                allFeeds.length === 0 ? 'No feeds configured.' : 'No feed matches that search'
              }
            />
          </div>
        </>
      )}
    </PageContainer>
  )
}
