'use client'

import { Fragment } from 'react'
import Link from 'next/link'
import { Star } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { SkeletonCard } from '@/components/ui/skeleton-card'
import { NoData } from '@/components/ui/no-data'
import { ItemsTable, type Column } from '@/components/shared/items-table'
import { FavoritesControl } from '@/components/shared/favorites-control'
import { featureList } from '@/features'
import { SlotList, hasSlotContributor } from '@/features/slots'
import { useVeodynFavorites } from '@/hooks/use-favorites'
import { TimeAgo } from '@/components/shared/time-ago'
import { MICRO_LABEL } from '@/lib/section-heading'
import { TagsControl } from '@/components/shared/tags-control'
import { useFavoriteQueries } from '@/hooks/use-queries'
import { useFavoriteDashboards } from '@/hooks/use-dashboards'
import type { MockQuery, MockDashboard } from '@/lib/mock-data'
import { PageContainer } from '@/components/layout/page-container'
import { ENTITY_NAME_CLASS } from '@/lib/entity-name'

/**
 * Where a reader can go to star something, for the empty state to name.
 *
 * Queries and dashboards are in every build; the rest is derived from the
 * features that fill `favorites.section`, so a build without a feature offers
 * no link that 404s. Filtered to the library section, the row that names the
 * feature's own collection rather than an admin console over it.
 */
const STARRABLE: { label: string; href: string }[] = [
  { label: 'Queries', href: '/queries' },
  { label: 'Dashboards', href: '/dashboards' },
  ...featureList()
    .filter((feature) => feature.slots?.['favorites.section'] !== undefined)
    .flatMap((feature) => feature.nav.filter((row) => row.section === 'library')),
]

const queryColumns: Column<MockQuery>[] = [
  {
    key: 'favorite',
    title: '',
    width: 'w-10',
    render: (q) => <FavoritesControl type="queries" id={q.id} isFavorite={q.is_favorite} />,
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
        {q.tags.length > 0 && <TagsControl tags={q.tags} className="mt-1" />}
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
    key: 'updated_at',
    title: 'Updated',
    sortValue: (q) => q.updated_at,
    render: (q) => <TimeAgo date={q.updated_at} className="text-muted-foreground" />,
  },
]

const dashboardColumns: Column<MockDashboard>[] = [
  {
    key: 'favorite',
    title: '',
    width: 'w-10',
    render: (d) => <FavoritesControl type="dashboards" id={d.id} isFavorite={d.is_favorite} />,
  },
  {
    key: 'name',
    title: 'Name',
    sortValue: (d) => d.name,
    render: (d) => (
      <Link
        href={`/dashboards/${d.id}`}
        className={ENTITY_NAME_CLASS}
        onClick={(e) => e.stopPropagation()}
      >
        {d.name}
      </Link>
    ),
  },
  {
    key: 'created_by',
    title: 'Created By',
    sortValue: (d) => d.user?.name ?? '',
    render: (d) => <span className="text-muted-foreground">{d.user?.name ?? '-'}</span>,
  },
  {
    key: 'updated_at',
    title: 'Updated',
    sortValue: (d) => d.updated_at,
    render: (d) => <TimeAgo date={d.updated_at} className="text-muted-foreground" />,
  },
]

export default function FavoritesPage() {
  const queries = useFavoriteQueries()
  const dashboards = useFavoriteDashboards()
  // The sidecar keeps stars in a table of its own and answers with ids grouped
  // by kind. This page reads the ids only; rendering a kind belongs to the
  // feature that contributes the section.
  const sidecarStars = useVeodynFavorites()

  const favoriteQueries = queries.data?.results ?? []
  const favoriteDashboards = dashboards.data?.results ?? []
  const isLoading = queries.isLoading || dashboards.isLoading || sidecarStars.isLoading
  const truncated = queries.data?.truncated === true || dashboards.data?.truncated === true
  // A failed read is not an empty shelf, so "nothing starred yet" must not
  // stand in for one. Covers only the reads this page makes itself; a
  // contributed section reports its own failure.
  const failed = queries.isError || dashboards.isError || sidecarStars.isError
  // Counted as ids, and only where some feature can turn an id into a row: a
  // star this build will never render must not stop the page from saying the
  // shelf is empty.
  const starredSidecarIds = hasSlotContributor('favorites.section')
    ? Object.values(sidecarStars.data ?? {}).flat()
    : []
  const nothingStarred =
    !isLoading &&
    !failed &&
    favoriteQueries.length === 0 &&
    favoriteDashboards.length === 0 &&
    starredSidecarIds.length === 0

  return (
    <PageContainer>
      <PageHeader title="Favorites" description="Everything you have starred." />

      {/* Outside the branch below: a favorite is found by filtering the lists
          this page read, so an unread page and an unstarred account look
          identical. */}
      {truncated && (
        <p role="status" className="mb-3 text-sm text-muted-foreground">
          You have more queries and dashboards than this page reads, so some favorites may not be
          shown.
        </p>
      )}

      {failed && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          Some of your favorites could not be read just now, so this page may be
          missing things you have starred.
        </p>
      )}

      {isLoading ? (
        // The tables below render their own empty message from data that is
        // still undefined, so a first paint of "No favorite queries" would be a
        // wrong answer rather than a slow one.
        <SkeletonCard lines={4} />
      ) : nothingStarred ? (
        <NoData
          card
          icon={<Star className="h-6 w-6 mb-3 text-muted-foreground" />}
          message={
            truncated ? (
              'Nothing starred among the queries and dashboards this page could read, and there are more it did not read.'
            ) : (
              <>
                Nothing starred yet. Use the star on anything in{' '}
                {STARRABLE.map((row, index) => (
                  <Fragment key={row.href}>
                    {index > 0 && (index === STARRABLE.length - 1 ? ' or ' : ', ')}
                    <Link href={row.href} className="text-foreground underline underline-offset-4">
                      {row.label}
                    </Link>
                  </Fragment>
                ))}{' '}
                and it will appear here.
              </>
            )
          }
        />
      ) : (
        <div className="space-y-8">
          <section aria-labelledby="favorite-queries-heading">
            <h2
              id="favorite-queries-heading"
              className={`mb-2 ${MICRO_LABEL}`}
            >
              Queries
            </h2>
            <div className="rounded-lg border bg-card">
              <ItemsTable
                columns={queryColumns}
                items={favoriteQueries}
                rowKey={(q) => q.id}
                emptyMessage="No favorite queries"
              />
            </div>
          </section>

          <section aria-labelledby="favorite-dashboards-heading">
            <h2
              id="favorite-dashboards-heading"
              className={`mb-2 ${MICRO_LABEL}`}
            >
              Dashboards
            </h2>
            <div className="rounded-lg border bg-card">
              <ItemsTable
                columns={dashboardColumns}
                items={favoriteDashboards}
                rowKey={(d) => d.id}
                emptyMessage="No favorite dashboards"
              />
            </div>
          </section>

          {/* One section per object kind this build has (KPIs and reports
              today), each rendering only when it has something to show. A multi
              slot, so a build with one feature and not the other shows one and
              not the other. */}
          <SlotList id="favorites.section" props={{}} />
        </div>
      )}
    </PageContainer>
  )
}
