'use client'

// The Schedules table, split out of page.tsx when the cadence cell became a
// control and the page outgrew a single file. The state vocabulary lives here
// with the column that renders it.

import Link from 'next/link'
import { AlertTriangle, CircleCheck, CircleSlash } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TimeAgo } from '@/components/shared/time-ago'
import type { Column } from '@/components/shared/items-table'
import { describeSchedule, hasExpired, isOverdue } from '@/lib/query-schedule'
import { INLINE_TEXT_CONTROL } from '@/lib/inline-text-control'
import { ENTITY_NAME_CLASS } from '@/lib/entity-name'
import { cn } from '@/lib/utils'
import type { MockQuery } from '@/lib/mock-data'
import { ScheduleRowActions } from './schedule-row-actions'

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

function StateCell({ state }: { state: ScheduleState }) {
  const { label, Icon, className } = STATE_META[state]
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm font-medium', className)}>
      <Icon className="h-4 w-4" aria-hidden="true" />
      {label}
    </span>
  )
}

interface ScheduleColumnOptions {
  /** Who may change this row's schedule. Redash decides, per query. */
  canEdit: (query: MockQuery) => boolean
  onEdit: (query: MockQuery) => void
}

export function buildScheduleColumns({ canEdit, onEdit }: ScheduleColumnOptions): Column<MockQuery>[] {
  return [
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
      // The cadence is the control, the way it is in a query's own header: this
      // page was the one place that could show you every schedule at once and
      // the one place you could not touch any of them, so changing one meant
      // opening the query and finding the overflow menu. The name says which
      // schedule, because "Edit schedule" repeated down a column names nothing.
      render: (q) =>
        canEdit(q) ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => onEdit(q)}
            className={INLINE_TEXT_CONTROL}
          >
            {describeSchedule(q.schedule)}
            {/* Appended rather than an aria-label, which would REPLACE the
                visible words: a voice-control user says what they can see, and
                a name that does not contain it is a control they cannot ask
                for. */}
            <span className="sr-only">, change the refresh schedule for {q.name}</span>
          </Button>
        ) : (
          <span className="text-muted-foreground">{describeSchedule(q.schedule)}</span>
        ),
    },
    {
      key: 'state',
      title: 'State',
      sortValue: (q) => STATE_RANK[scheduleState(q)],
      render: (q) => <StateCell state={scheduleState(q)} />,
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
    // Both of this page's verbs, in the open. The clickable cadence above is
    // the shortcut for someone who has found it; these are what makes the page
    // look editable to someone who has not.
    {
      key: 'actions',
      title: '',
      width: 'w-20',
      render: (q) => <ScheduleRowActions query={q} canEdit={canEdit(q)} onEdit={onEdit} />,
    },
  ]
}
