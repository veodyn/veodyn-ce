// Reading a Redash query schedule as a person would say it.
//
// The stored shape is an interval in seconds plus optional time-of-day and
// day-of-week refinements: 86400 with time "06:00" means daily at 06:00, and
// 604800 with day_of_week "Monday" means weekly on Monday. The interval alone
// says how often, and the refinements say when, so both have to be read to
// describe the schedule truthfully.

export interface QuerySchedule {
  interval: number | null
  time: string | null
  day_of_week: string | null
  until: string | null
}

export interface ScheduledQuery {
  id: number
  name: string
  schedule: QuerySchedule | null
  retrieved_at: string
  user?: { name: string }
}

const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

function plural(count: number, unit: string): string {
  return count === 1 ? `every ${unit}` : `every ${count} ${unit}s`
}

/** "every 5 minutes", "daily at 06:00", "weekly on Monday at 23:00". */
export function describeSchedule(schedule: QuerySchedule | null): string {
  const interval = schedule?.interval
  if (!interval || interval <= 0) return 'not scheduled'

  const at = schedule?.time ? ` at ${schedule.time}` : ''

  if (interval % WEEK === 0) {
    const weeks = interval / WEEK
    const on = schedule?.day_of_week ? ` on ${schedule.day_of_week}` : ''
    return weeks === 1 ? `weekly${on}${at}` : `every ${weeks} weeks${on}${at}`
  }
  if (interval % DAY === 0) {
    const days = interval / DAY
    return days === 1 ? `daily${at}` : `every ${days} days${at}`
  }
  if (interval % HOUR === 0) return plural(interval / HOUR, 'hour')
  if (interval % MINUTE === 0) return plural(interval / MINUTE, 'minute')
  return plural(interval, 'second')
}

/** Milliseconds between runs, for judging whether a run is overdue. */
export function scheduleIntervalMs(schedule: QuerySchedule | null): number | null {
  const interval = schedule?.interval
  if (!interval || interval <= 0) return null
  return interval * 1000
}

/**
 * A scheduled query is late when more than two intervals have passed since its
 * last result. Two rather than one, so a run that merely started a little
 * behind does not flag: the same rule the feed freshness check uses.
 */
export function isOverdue(query: ScheduledQuery, now: number = Date.now()): boolean {
  const period = scheduleIntervalMs(query.schedule)
  if (period === null) return false
  if (!query.retrieved_at) return true
  const last = new Date(query.retrieved_at).getTime()
  if (Number.isNaN(last)) return true
  return now - last > period * 2
}

/** Schedules that have expired are not upcoming, whatever the interval says. */
export function hasExpired(schedule: QuerySchedule | null, now: number = Date.now()): boolean {
  if (!schedule?.until) return false
  const until = new Date(schedule.until).getTime()
  if (Number.isNaN(until)) return false
  return until < now
}

/**
 * Will this schedule actually run the query again?
 *
 * Both halves matter and a truthiness check on the object gets both wrong.
 * Redash spells "never" as an interval of 0, not as a null schedule, so a
 * `{ interval: 0 }` object is present but inert; and a schedule whose `until`
 * has passed has a live-looking interval it will never act on again. Callers
 * that only asked `schedule != null` reported both as scheduled.
 */
export function hasActiveSchedule(
  schedule: QuerySchedule | null | undefined,
  now: number = Date.now()
): boolean {
  const interval = schedule?.interval
  if (!schedule || !interval || interval <= 0) return false
  return !hasExpired(schedule, now)
}
