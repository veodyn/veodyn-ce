'use client'

// The Schedules nav item 404'd, while the data behind it was already there:
// every query carries a Redash schedule, and /admin/outdated was reading it.
// That page is admin-only and shows only what is late. This is the whole
// picture, for everyone: what runs, how often, and whether it is keeping up.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { CalendarClock, CircleCheck, AlertTriangle, CircleSlash } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { ItemsTable, type Column } from '@/components/shared/items-table'
import { ListToolbar } from '@/components/shared/list-toolbar'
import { NoData } from '@/components/ui/no-data'
import { TimeAgo } from '@/components/shared/time-ago'
import { useAllQueries } from '@/hooks/use-queries'
import { describeSchedule, hasExpired, isOverdue } from '@/lib/query-schedule'
import { matchesSearch } from '@/lib/list-filter'
import { cn } from '@/lib/utils'
import type { MockQuery } from '@/lib/mock-data'
import { PageContainer } from '@/components/layout/page-container'
import { ENTITY_NAME_CLASS } from '@/lib/entity-name'

type ScheduleState = 'on-time' | 'late' | 'expired'

// Same convention as Feed Health: icon plus text plus a semantic token, never
// colour alone.
const STATE_META = {
  'on-time': { label: 'On time', Icon: CircleCheck, className: 'text-status-fresh' },
  late: { label: 'Late', Icon: AlertTriangle, className: 'text-status-stale' },
  expired: { label: 'Expired', Icon: CircleSlash, className: 'text-muted-foreground' },
} as const

// Ordering for the default sort, so what needs attention is at the top rather
// than wherever the label happens to fall in the alphabet.
const STATE_RANK: Record<ScheduleState, number> = { late: 0, 'on-time': 1, expired: 2 }

function scheduleState(query: MockQuery): ScheduleState {
  if (hasExpired(query.schedule)) return 'expired'
  return isOverdue(query) ? 'late' : 'on-time'
}

function ScheduleState({ state }: { state: ScheduleState }) {
  const { label, Icon, className } = STATE_META[state]
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm font-medium', className)}>
      <Icon className="h-4 w-4" aria-hidden="true" />
      {label}
    </span>
  )
}

const columns: Column<MockQuery>[] = [
  {
    key: 'name',
    title: 'Query',
    sortValue: (q) => q.name,
    render: (q) => (
      <Link
        href={`/queries/${q.id}`}
        className={ENTITY_NAME_CLASS}
        onClick={(e) => e.stopPropagation()}
      >
        {q.name}
      </Link>
    ),
  },
  {
    key: 'schedule',
    title: 'Runs',
    sortValue: (q) => q.schedule?.interval ?? null,
    render: (q) => <span className="text-muted-foreground">{describeSchedule(q.schedule)}</span>,
  },
  {
    key: 'state',
    title: 'State',
    sortValue: (q) => STATE_RANK[scheduleState(q)],
    render: (q) => <ScheduleState state={scheduleState(q)} />,
  },
  {
    key: 'retrieved_at',
    title: 'Last Result',
    sortValue: (q) => q.retrieved_at,
    render: (q) =>
      q.retrieved_at ? (
        <TimeAgo date={q.retrieved_at} className="text-muted-foreground" />
      ) : (
        <span className="text-muted-foreground">never</span>
      ),
  },
  {
    key: 'owner',
    title: 'Owner',
    sortValue: (q) => q.user?.name ?? '',
    render: (q) => <span className="text-muted-foreground">{q.user?.name ?? '-'}</span>,
  },
]

export default function SchedulesPage() {
  const { data, isLoading } = useAllQueries()
  const [search, setSearch] = useState('')

  const allScheduled = useMemo(
    () => (data?.results ?? []).filter((query) => !query.is_archived && query.schedule?.interval),
    [data]
  )
  const scheduled = useMemo(
    () => allScheduled.filter((query) => matchesSearch(search, [query.name, query.user?.name])),
    [allScheduled, search]
  )

  const nothingScheduled = !isLoading && allScheduled.length === 0
  // The reader gives up at a page cap. Saying so beats a monitoring screen that
  // quietly leaves out the schedule someone came here to find.
  const truncated = data?.truncated === true

  return (
    <PageContainer>
      <PageHeader
        title="Schedules"
        description="Every query with a refresh schedule, and whether it is keeping up."
      />

      {/* Outside the branch below: the emptier the page looks, the more this
          matters. "Nothing is scheduled" is the one claim an unread page must
          not make on its own. */}
      {truncated && (
        <p role="status" className="mb-3 text-sm text-muted-foreground">
          This instance has more queries than this page reads, so some schedules may not be shown.
        </p>
      )}

      {nothingScheduled ? (
        <NoData
          card
          icon={<CalendarClock className="h-6 w-6 mb-3 text-muted-foreground" />}
          message={
            truncated ? (
              'No query this page could read has a refresh schedule, and there are more it did not read.'
            ) : (
              <>
                No query has a refresh schedule yet. Open a{' '}
                <Link href="/queries" className="text-foreground underline underline-offset-4">
                  query
                </Link>{' '}
                and set one to see it here.
              </>
            )
          }
        />
      ) : (
        <>
          <ListToolbar
            search={search}
            onSearchChange={setSearch}
            searchLabel="Search schedules"
            placeholder="Search by query or owner..."
            count={scheduled.length}
            noun="schedule"
          />
          <div className="rounded-lg border bg-card">
            <ItemsTable
              columns={columns}
              items={scheduled}
              rowKey={(q) => q.id}
              defaultSort={{ key: 'state', dir: 'asc' }}
              emptyMessage="No schedule matches that search"
            />
          </div>
        </>
      )}
    </PageContainer>
  )
}
