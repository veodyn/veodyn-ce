// The one line the query header needs about a query's refresh schedule.
// The header carried "Updated <when>" and nothing about whether the query
// updates itself, so the only way to find out was the overflow menu and then
// the Schedule dialog. The phrasing is borrowed from describeSchedule rather
// than written again here, so a schedule reads the same in this header as it
// does in the Schedules list.

import { formatCalendarDate } from '@/lib/format-datetime'
import { describeSchedule, hasExpired, type QuerySchedule } from '@/lib/query-schedule'

export type ScheduleState = 'set' | 'ended' | 'unset'

export interface ScheduleSummary {
  /** The whole phrase, ready to render. */
  text: string
  state: ScheduleState
}

export function formatQuerySchedule(
  schedule: QuerySchedule | null | undefined,
  now: number = Date.now()
): ScheduleSummary {
  const interval = schedule?.interval
  if (!schedule || !interval || interval <= 0) {
    return { text: 'No refresh schedule', state: 'unset' }
  }

  // An expired schedule still has an interval, and describing it would claim a
  // refresh that will never come.
  if (hasExpired(schedule, now)) {
    return { text: `Schedule ended ${formatCalendarDate(schedule.until)}`, state: 'ended' }
  }

  return { text: `Refreshes ${describeSchedule(schedule)}`, state: 'set' }
}
