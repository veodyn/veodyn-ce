'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { AdministeredNote } from '@/components/published-feeds/administered-note'
import { ItemsTable, type Column } from '@/components/shared/items-table'
import { ListToolbar } from '@/components/shared/list-toolbar'
import { ListLoadError } from '@/components/shared/list-load-error'
import { SkeletonCard } from '@/components/ui/skeleton-card'
import { buttonVariants } from '@/components/ui/button'
import { matchesSearch } from '@/lib/list-filter'
import { usePublishedFeeds } from '@/hooks/use-published-feeds'
import { useAllQueries } from '@/hooks/use-queries'
import { useAuthStore } from '@/stores/auth-store'
import { PageContainer } from '@/components/layout/page-container'
import type { PublishedFeed } from '@/types/published-feed'

// Typed against the standard union, so adding one fails to compile here until
// it has a label rather than rendering a raw wire value.
const STANDARD_LABEL: Record<PublishedFeed['standard'], string> = {
  'gtfs-rt': 'GTFS-Realtime',
  gbfs: 'GBFS',
}
const ENTITY_LABEL: Record<PublishedFeed['entity'], string> = {
  vehicle_positions: 'vehicle positions',
  stations: 'stations',
}

// The address column is the slug plus what it is bound to, matching Feed
// Health's Feed column (name over source). A slug on its own answers "what is
// this called", not "where does its data come from"; the query name answers
// the second question without a click.
function buildColumns(queryNameById: Map<number, string>): Column<PublishedFeed>[] {
  return [
    {
      key: 'address',
      title: 'Address',
      sortValue: (f) => f.slug,
      render: (f) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{f.slug}</div>
          <div className="font-mono text-xs text-muted-foreground">
            {queryNameById.get(f.queryId) ?? `query ${f.queryId}`}
          </div>
        </div>
      ),
    },
    {
      key: 'standard',
      title: 'Standard',
      sortValue: (f) => f.standard,
      render: (f) => (
        <span className="text-sm">
          {STANDARD_LABEL[f.standard]} {f.version} · {ENTITY_LABEL[f.entity]}
        </span>
      ),
    },
    {
      key: 'access',
      title: 'Access',
      sortValue: (f) => f.visibility,
      render: (f) => <span className="text-sm capitalize">{f.visibility}</span>,
    },
    {
      key: 'revision',
      title: 'Revision',
      sortValue: (f) => f.revision,
      render: (f) => (
        <span className="font-mono text-xs tabular-nums text-muted-foreground">{f.revision}</span>
      ),
    },
  ]
}

export default function PublishedFeedsPage() {
  const router = useRouter()
  const { data: feeds, isLoading, isError, refetch } = usePublishedFeeds()
  // Every page, not just the first 25: this is a small lookup, not a list of
  // its own, so it reads the same way /schedules already does.
  const { data: queries } = useAllQueries()
  const [search, setSearch] = useState('')
  // Not admin-gated: the API serves this list to any org member. Only the
  // create action below is gated, because that is the only part of the page
  // that actually needs admin.
  const isAdmin = useAuthStore((s) => s.currentUser)?.isAdmin

  const queryNameById = useMemo(() => {
    const map = new Map<number, string>()
    for (const q of queries?.results ?? []) map.set(q.id, q.name)
    return map
  }, [queries])

  const allFeeds = useMemo(() => feeds ?? [], [feeds])
  const visible = useMemo(
    () =>
      allFeeds.filter((f) =>
        matchesSearch(search, [f.slug, queryNameById.get(f.queryId), f.visibility])
      ),
    [allFeeds, search, queryNameById]
  )

  return (
    <PageContainer>
      <PageHeader
        title="Published Feeds"
        description="Feeds this instance serves to riders and downstream consumers."
        action={
          // A plain Link styled with buttonVariants, not `Button
          // render={<Link/>}`: Base UI's Button primitive stamps
          // role="button" onto whatever it renders, which would turn this
          // navigation control into something a screen reader announces as a
          // button rather than the link it actually is.
          isAdmin ? (
            <Link href="/connect/feeds/new" className={buttonVariants()}>
              <Plus className="h-4 w-4" />
              Publish a feed
            </Link>
          ) : undefined
        }
      />
      {!isAdmin && (
        <div className="mb-4">
          <AdministeredNote />
        </div>
      )}
      {isLoading ? (
        <SkeletonCard />
      ) : isError ? (
        <ListLoadError noun="published feeds" onRetry={() => refetch()} />
      ) : (
        <>
          <ListToolbar
            search={search}
            onSearchChange={setSearch}
            searchLabel="Search published feeds"
            placeholder="Search by slug or query..."
            count={visible.length}
            noun="feed"
          />
          <div className="rounded-lg border bg-card">
            <ItemsTable
              columns={buildColumns(queryNameById)}
              items={visible}
              rowKey={(f) => f.slug}
              // The detail page carries the whole attempt history and is
              // otherwise reachable only by typing its URL: no column here
              // renders a link. Row navigation is how every sibling list in
              // this app opens a record (queries, dashboards), so it is how
              // this one does too.
              onRowClick={(f) => router.push(`/connect/feeds/${f.slug}`)}
              emptyMessage={
                allFeeds.length === 0
                  ? 'No feeds are published yet.'
                  : 'No published feed matches that search'
              }
            />
          </div>
        </>
      )}
    </PageContainer>
  )
}
