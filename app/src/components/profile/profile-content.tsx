'use client'

import Link from 'next/link'

import { OwnedSection } from '@/components/shared/owned-section'
import { TimeAgo } from '@/components/shared/time-ago'
import { SlotList } from '@/features/slots'
import { type Column } from '@/components/shared/items-table'
import { useMyQueries } from '@/hooks/use-queries'
import { useMyDashboards } from '@/hooks/use-dashboards'
import type { MockQuery, MockDashboard } from '@/lib/mock-data'
import { ENTITY_NAME_CLASS } from '@/lib/entity-name'

// ---------------------------------------------------------------------------
// Owned-content sections for the profile page: the queries and dashboards this
// person created, plus one section per object kind the installed features add.
// Modelled on src/app/favorites/page.tsx, and split the same way: the page owns
// the stack and the two Redash halves, and everything whose kind leaves with a
// feature arrives through the profile.section slot.
//
// A MULTI slot, with one contributor today. KPIs is the only enterprise kind
// with an owner on the profile page right now, but a reports section is the
// obvious next one, and registering this as single-contributor would make that
// addition silently drop one of the two.
// ---------------------------------------------------------------------------

const queryColumns: Column<MockQuery>[] = [
  {
    key: 'name',
    title: 'Name',
    sortValue: (q) => q.name,
    render: (q) => (
      <Link href={`/queries/${q.id}`} className={ENTITY_NAME_CLASS}>
        {q.name}
      </Link>
    ),
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
    key: 'name',
    title: 'Name',
    sortValue: (d) => d.name,
    render: (d) => (
      <Link href={`/dashboards/${d.id}`} className={ENTITY_NAME_CLASS}>
        {d.name}
      </Link>
    ),
  },
  {
    key: 'updated_at',
    title: 'Updated',
    sortValue: (d) => d.updated_at,
    render: (d) => <TimeAgo date={d.updated_at} className="text-muted-foreground" />,
  },
]

export function ProfileContent({ userId }: { userId: number }) {
  const queries = useMyQueries()
  const dashboards = useMyDashboards()

  return (
    <div className="space-y-8">
      <OwnedSection
        title="Your Queries"
        isLoading={queries.isLoading}
        isError={queries.isError}
        items={queries.data?.results ?? []}
        columns={queryColumns}
        rowKey={(q) => q.id}
        emptyMessage="No queries yet"
        errorMessage="Unable to load your queries."
      />
      <OwnedSection
        title="Your Dashboards"
        isLoading={dashboards.isLoading}
        isError={dashboards.isError}
        items={dashboards.data?.results ?? []}
        columns={dashboardColumns}
        rowKey={(d) => d.id}
        emptyMessage="No dashboards yet"
        errorMessage="Unable to load your dashboards."
      />
      {/* The id, not the object and not a display name: ownership is compared
          on ownerId, and a contributed section resolves the rest for itself. */}
      <SlotList id="profile.section" props={{ userId }} />
    </div>
  )
}
