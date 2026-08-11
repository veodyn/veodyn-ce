'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { CreateWithAiButton } from '@/components/ai/create-chat/create-with-ai-button'
import { PageHeader } from '@/components/layout/page-header'
import { ItemsTable, LIST_PAGE_SIZE, type Column } from '@/components/shared/items-table'
import { ListToolbar } from '@/components/shared/list-toolbar'
import { FavoritesControl } from '@/components/shared/favorites-control'
import { TimeAgo } from '@/components/shared/time-ago'
import { TagsControl } from '@/components/shared/tags-control'
import { Button } from '@/components/ui/button'
import {
  useAllQueries,
  useMyQueries,
  useFavoriteQueries,
  useArchivedQueries,
} from '@/hooks/use-queries'
import { QueryRowActions } from './query-row-actions'
import { ListPageTabs } from '@/components/shared/list-page-tabs'
import { ListLoadError } from '@/components/shared/list-load-error'
import type { MockQuery } from '@/lib/mock-data'
import { PageContainer } from '@/components/layout/page-container'
import { ENTITY_NAME_CLASS } from '@/lib/entity-name'

const tabs = [
  { key: 'all', label: 'All Queries' },
  { key: 'my', label: 'My Queries' },
  { key: 'favorites', label: 'Favorites' },
  { key: 'archive', label: 'Archive' },
]

export default function QueriesPage() {
  return <Suspense><QueriesContent /></Suspense>
}

function QueriesContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tab = searchParams.get('tab') || 'all'
  const [search, setSearch] = useState('')

  // useAllQueries, not useQueries: the table sorts and counts the set it is
  // given, so a single 25-row server page would have made "sort by name" mean
  // "sort these 25 by name" and "300 queries" read as "25 queries". Paging
  // happens in the table, below, over the whole library.
  // Every tab gets the term. Passing it only to the first one left the box
  // dead on the other three while still showing a clear button and an
  // unfiltered count.
  const allQueries = useAllQueries({ search })
  const myQueries = useMyQueries({ search })
  const favoriteQueries = useFavoriteQueries({ search })
  const archivedQueries = useArchivedQueries({ search })

  const dataMap = {
    all: allQueries.data,
    my: myQueries.data,
    favorites: favoriteQueries.data,
    archive: archivedQueries.data,
  }

  // The branch has to follow the ACTIVE tab, not any single hook: each tab has
  // its own, and reading isError off `allQueries` would report the wrong tab's
  // health while the reader looks at another.
  const statusMap = {
    all: allQueries,
    my: myQueries,
    favorites: favoriteQueries,
    archive: archivedQueries,
  }
  const activeQuery = statusMap[tab as keyof typeof statusMap]

  const active = dataMap[tab as keyof typeof dataMap]
  const items = active?.results ?? []
  // The read gives up at a page cap, and a library list that silently stops is
  // the bug this page is fixing, so say so rather than let the last page look
  // like the end of the library.
  const truncated = active?.truncated === true

  const columns: Column<MockQuery>[] = [
    {
      key: 'favorite',
      title: '',
      width: 'w-10',
      render: (q) => (
        <FavoritesControl type="queries" id={q.id} isFavorite={q.is_favorite} />
      ),
    },
    {
      key: 'name',
      title: 'Name',
      sortValue: (q) => q.name,
      render: (q) => (
        <div>
          <Link
            href={`/queries/${q.id}`}
            className={ENTITY_NAME_CLASS}
            onClick={(e) => e.stopPropagation()}
          >
            {q.name}
          </Link>
          {q.tags.length > 0 && (
            <TagsControl tags={q.tags} className="mt-1" />
          )}
        </div>
      ),
    },
    {
      key: 'created_by',
      title: 'Created By',
      sortValue: (q) => q.user?.name ?? '',
      render: (q) => <span className="text-muted-foreground">{q.user?.name ?? '-'}</span>,
    },
    {
      key: 'created_at',
      title: 'Created At',
      sortValue: (q) => q.created_at,
      render: (q) => <TimeAgo date={q.created_at} className="text-muted-foreground" />,
    },
    {
      key: 'updated_at',
      title: 'Updated',
      sortValue: (q) => q.updated_at,
      render: (q) => <TimeAgo date={q.updated_at} className="text-muted-foreground" />,
    },
    {
      key: 'runtime',
      title: 'Runtime',
      sortValue: (q) => q.runtime,
      render: (q) => (
        <span className="text-muted-foreground">
          {q.runtime ? `${q.runtime.toFixed(2)}s` : '-'}
        </span>
      ),
    },
    // One column on every tab, holding whatever this person may do to this row:
    // Restore on the Archive tab, Archive everywhere else, and nothing at all
    // for someone the backend would refuse. It used to be a Restore button in a
    // column that only existed on one tab, which left Archive reachable only
    // from the query's own page and unconfirmed when you got there.
    {
      key: 'actions',
      title: '',
      width: 'w-12',
      render: (q) => <QueryRowActions query={q} archived={tab === 'archive'} />,
    },
  ]

  return (
    <PageContainer>
      {/* PageHeader's action slot is already `flex items-center gap-2`, so the
          two header buttons need no flex wrapper of their own: a fragment leaves
          the AI-off DOM byte-identical, since CreateWithAiButton renders null.
          The AI button sits first so New Query keeps the position users reach
          for. */}
      <PageHeader
        title="Queries"
        description="Saved SQL you can run, schedule, and build dashboards from."
        action={
          <>
            <CreateWithAiButton kind="query" />
            <Button render={<Link href="/queries/new" />}>
              <Plus className="h-4 w-4" />
              New Query
            </Button>
          </>
        }
      />

      <ListToolbar
        search={search}
        onSearchChange={setSearch}
        searchLabel="Search queries"
        placeholder="Search queries..."
        count={items.length}
        noun="query"
        nounPlural="queries"
        filters={
          <ListPageTabs
            tabs={tabs}
            active={tab}
            href={(key) => `/queries?tab=${key}`}
            label="Filter queries"
          />
        }
      />

      {truncated && (
        <p role="status" className="mb-3 text-sm text-muted-foreground">
          This instance has more queries than this page reads. Search to narrow the list.
        </p>
      )}

      <div className="bg-card rounded-lg border">
        {activeQuery.isError ? (
          <ListLoadError noun="queries" onRetry={() => activeQuery.refetch()} />
        ) : (
          <ItemsTable
            columns={columns}
            items={items}
            rowKey={(q) => q.id}
            onRowClick={(q) => router.push(`/queries/${q.id}`)}
            emptyMessage="No queries found"
            pageSize={LIST_PAGE_SIZE}
            // A different tab or a different search is a different list, so it
            // opens at page 1 rather than wherever the reader was in the old one.
            pageKey={`${tab}|${search}`}
          />
        )}
      </div>
    </PageContainer>
  )
}
