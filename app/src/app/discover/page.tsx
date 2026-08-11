'use client'

import Link from 'next/link'
import { useState } from 'react'
import { LayoutDashboard, BarChart3, Star, Compass } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { ListToolbar } from '@/components/shared/list-toolbar'
import { matchesSearch } from '@/lib/list-filter'
import { ENTITY_NAME_CLASS } from '@/lib/entity-name'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { NoData } from '@/components/ui/no-data'
import { SkeletonCard } from '@/components/ui/skeleton-card'
import { TimeAgo } from '@/components/shared/time-ago'
import { useAllDashboards } from '@/hooks/use-dashboards'
import { useAllQueries } from '@/hooks/use-queries'
import { ListLoadError } from '@/components/shared/list-load-error'
import { rankDiscover } from '@/lib/discover'
import { PageContainer } from '@/components/layout/page-container'

// Discover: the org's most notable dashboards and queries, ranked by stars then
// recency (see src/lib/discover.ts). Reports join this list once the Reports
// spec lands; view-count ranking once the metadata carries it.
export default function DiscoverPage() {
  // useAllDashboards / useAllQueries, not the paged hooks. This page promises
  // "the most notable across the org" and was ranking at most the first 25 of
  // each, in whatever order the backend returned them. On the reference
  // instance that put a favourited query outside the window entirely: favorites
  // are the hard top tier in rankDiscover, so it should always have surfaced,
  // and it was simply never in the input set.
  const { data: dashboards, isLoading: dLoading, isError: dError } = useAllDashboards()
  const { data: queries, isLoading: qLoading, isError: qError } = useAllQueries()
  const isLoading = dLoading || qLoading
  const isError = dError || qError
  // A page whose whole claim is "across the org" is the last place a silent cap
  // belongs, so say when the read gave up rather than ranking a subset quietly.
  const truncated = dashboards?.truncated === true || queries?.truncated === true
  const [search, setSearch] = useState('')
  // Filter before ranking, never after. rankDiscover slices to its top 12, so
  // filtering its output searched only the twelve cards already on screen:
  // anything the ranking did not surface could not be found here however
  // exactly you typed its name, while the global search found it immediately.
  const ranked = rankDiscover(
    (dashboards?.results ?? []).filter((d) => matchesSearch(search, [d.name])),
    (queries?.results ?? []).filter((q) => matchesSearch(search, [q.name]))
  )

  return (
    <PageContainer>
      <PageHeader title="Discover" description="The most notable dashboards and queries across the org." />
      {/* This page had no controls at all: no search, no count, nothing, while
          every other browse surface has both. The count is the shared one, so
          "12 items" reads the same here as on any list. */}
      <ListToolbar
        search={search}
        onSearchChange={setSearch}
        searchLabel="Search dashboards and queries"
        placeholder="Search Discover..."
        count={ranked.length}
        noun="item"
      />
      {truncated && (
        <p role="status" className="mb-3 text-sm text-muted-foreground">
          This instance has more objects than this page reads, so the ranking
          below is drawn from part of the library. Search to narrow it.
        </p>
      )}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : isError ? (
        <ListLoadError noun="dashboards and queries" />
      ) : ranked.length === 0 ? (
        <NoData
          icon={<Compass className="h-8 w-8" />}
          message={search ? 'Nothing matches that search.' : 'Nothing to discover yet.'}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {ranked.map((item) => (
            <Link key={`${item.type}-${item.id}`} href={item.href} className="block">
              {/* Card supplies py-4 only; px-4 lives on CardHeader/CardContent,
                  which this layout does not use. Matches the same card pattern
                  on the data-sources and destinations pages. */}
              <Card className="gap-2 px-4 transition-colors hover:ring-primary/50">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    {item.type === 'dashboard' ? (
                      <LayoutDashboard className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <BarChart3 className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className={`truncate ${ENTITY_NAME_CLASS}`}>{item.name}</span>
                  </div>
                  {item.isFavorite && (
                    <Star className="h-4 w-4 shrink-0 fill-favorite text-favorite" aria-label="Favorite" />
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline">{item.type === 'dashboard' ? 'Dashboard' : 'Query'}</Badge>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    <TimeAgo date={item.updatedAt} />
                  </span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </PageContainer>
  )
}
