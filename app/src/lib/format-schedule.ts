// The one line the query header needs about a query's refresh schedule.
//
// The header carried "Updated <when>" and nothing about whether the query
// updates itself, so the only way to find out was the overflow menu and then
// the Schedule dialog. The phrasing is borrowed from describeSchedule rather
// than written again here, so a schedule reads the same in this header as it
// does in the Schedules list.
//
// Every query gets a phrase, the unscheduled ones included. This used to return
// null for those, on the grounds that a chip on every unscheduled query costs
// header room it does not pay back. It pays back twice over: the absence is
// itself an answer to "how current is this", and shown nothing at all a reader
// cannot tell "runs on demand" from "this page does not mention schedules". The
// phrase is also the control, so the query that most needs a schedule was
// exactly the one whose header offered no way to set one.

import { formatCalendarDate } from '@/lib/format-datetime'
import { describeSchedule, hasExpired, type QuerySchedule } from '@/lib/query-schedule'

/**
 * `set` refreshes itself, `ended` did until its `until` date passed, `unset`
 * never has (Redash spells that a null schedule, or an interval of zero).
 */
export type ScheduleState = 'set' | 'ended' | 'unset'

export interface ScheduleSummary {
  /** The whole phrase, ready to render. */
  text: string
  state: ScheduleState
}

/**
 * "Refreshes daily at 06:00", "Schedule ended 07/01/26" once `until` is in the
 * past, or "No refresh schedule" when there is none.
 */
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
