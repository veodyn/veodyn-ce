// The one line the query header needs about a query's refresh schedule.
//
// The header carried "Updated <when>" and nothing about whether the query
// updates itself, so the only way to find out was the overflow menu and then
// the Schedule dialog. The phrasing is borrowed from describeSchedule rather
// than written again here, so a schedule reads the same in this header as it
// does in the Schedules list.

import { formatCalendarDate } from '@/lib/format-datetime'
import { describeSchedule, hasExpired, type QuerySchedule } from '@/lib/query-schedule'

export interface ScheduleSummary {
  /** The whole phrase, ready to render. */
  text: string
  /** `until` has passed, so the schedule no longer runs. */
  ended: boolean
}

/**
 * "Refreshes daily at 06:00", or "Schedule ended 07/01/26" once `until` is in
 * the past.
 *
 * Null when there is nothing to say: no schedule object, or one whose interval
 * is absent or zero, which is how Redash spells "never". The caller renders
 * nothing in that case, because a "Not scheduled" chip on every unscheduled
 * query would cost more room in the header than it pays back.
 */
export function formatQuerySchedule(
  schedule: QuerySchedule | null | undefined,
  now: number = Date.now()
): ScheduleSummary | null {
  const interval = schedule?.interval
  if (!schedule || !interval || interval <= 0) return null

  // An expired schedule still has an interval, and describing it would claim a
  // refresh that will never come.
  if (hasExpired(schedule, now)) {
    return { text: `Schedule ended ${formatCalendarDate(schedule.until)}`, ended: true }
  }

  return { text: `Refreshes ${describeSchedule(schedule)}`, ended: false }
}
