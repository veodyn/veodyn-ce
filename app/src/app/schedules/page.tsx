'use client'

// The Schedules nav item 404'd, while the data behind it was already there:
// every query carries a Redash schedule, and /admin/outdated was reading it.
// That page is admin-only and shows only what is late. This is the whole
// picture, for everyone: what runs, how often, and whether it is keeping up.
//
// And, for anyone Redash would let write, where you change it. A monitoring
// page that can only report is a page you leave to go and act somewhere else.

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
  // The row whose schedule is being changed, rather than a boolean: the dialog
  // seeds its fields from the schedule it is handed, so it has to be handed a
  // particular query's.
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

  // Both halves matter. A list payload carries no can_edit at all: Redash
  // attaches it in QueryResource.get only (handlers/queries.py:402), so a gate
  // reading it alone would hide these controls from every author on the page.
  // And a detail-shaped row that does carry it is authoritative, including for
  // an ACL grant that owner-or-admin cannot see.
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

      {/* Mounted only while a row is being edited, and keyed to that row, so it
          opens on the schedule you clicked rather than on the last one. */}
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
                // Clearing a schedule takes the row off this page, which on its
                // own reads as the click having gone wrong.
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
