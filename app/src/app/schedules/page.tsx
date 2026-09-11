'use client'

// The Schedules nav item 404'd, while the data behind it was already there:
// every query carries a Redash schedule, and /admin/outdated was reading it.
// That page is admin-only and shows only what is late. This is the whole
// picture, for everyone: what runs, how often, and whether it is keeping up.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { CalendarClock } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { ItemsTable } from '@/components/shared/items-table'
import { ListToolbar } from '@/components/shared/list-toolbar'
import { NoData } from '@/components/ui/no-data'
import { ScheduleDialog } from '@/components/query/schedule-dialog'
import { useToast } from '@/components/shared/toast-provider'
import { useAllQueries, useUpdateQuery } from '@/hooks/use-queries'
import { useAuthStore } from '@/stores/auth-store'
import { matchesSearch } from '@/lib/list-filter'
import type { MockQuery } from '@/lib/mock-data'
import { PageContainer } from '@/components/layout/page-container'
import { buildScheduleColumns } from './schedule-columns'

export default function SchedulesPage() {
  const { data, isLoading } = useAllQueries()
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<MockQuery | null>(null)
  const updateQuery = useUpdateQuery()
  const toast = useToast()
  const currentUser = useAuthStore((s) => s.currentUser)

  const allScheduled = useMemo(
    () => (data?.results ?? []).filter((query) => !query.is_archived && query.schedule?.interval),
    [data]
  )
  const scheduled = useMemo(
    () => allScheduled.filter((query) => matchesSearch(search, [query.name, query.user?.name])),
    [allScheduled, search]
  )

  const columns = buildScheduleColumns({
    canEdit: (query) => Boolean(query.can_edit || currentUser?.canEdit(query)),
    onEdit: setEditing,
  })

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

      {editing && (
        <ScheduleDialog
          key={editing.id}
          open
          onClose={() => setEditing(null)}
          schedule={editing.schedule}
          onSave={(schedule) =>
            updateQuery.mutate(
              { id: editing.id, schedule },
              {
                onSuccess: () =>
                  toast.success(
                    schedule
                      ? `Schedule updated for ${editing.name}`
                      : `Schedule removed from ${editing.name}`
                  ),
                onError: () => toast.error(`Could not save the schedule for ${editing.name}`),
              }
            )
          }
        />
      )}
    </PageContainer>
  )
}
