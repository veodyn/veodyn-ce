import { describe, expect, it } from 'vitest'
import { describeSchedule, hasExpired, isOverdue, scheduleIntervalMs } from '@/lib/query-schedule'

const at = (time: string | null = null, dayOfWeek: string | null = null, until: string | null = null) => ({
  time,
  day_of_week: dayOfWeek,
  until,
})

describe('describeSchedule', () => {
  it('reads a sub-hour interval in minutes', () => {
    expect(describeSchedule({ interval: 60, ...at() })).toBe('every minute')
    expect(describeSchedule({ interval: 300, ...at() })).toBe('every 5 minutes')
  })

  it('reads hours as hours', () => {
    expect(describeSchedule({ interval: 3600, ...at() })).toBe('every hour')
    expect(describeSchedule({ interval: 7200, ...at() })).toBe('every 2 hours')
  })

  it('names the time of day a daily schedule runs at', () => {
    expect(describeSchedule({ interval: 86400, ...at('06:00') })).toBe('daily at 06:00')
    expect(describeSchedule({ interval: 86400, ...at() })).toBe('daily')
  })

  it('names the day a weekly schedule runs on', () => {
    expect(describeSchedule({ interval: 604800, ...at('23:00', 'Monday') })).toBe(
      'weekly on Monday at 23:00'
    )
  })

  it('falls back to seconds for an interval that divides into nothing', () => {
    expect(describeSchedule({ interval: 90, ...at() })).toBe('every 90 seconds')
  })

  it('says so when there is no schedule at all', () => {
    expect(describeSchedule(null)).toBe('not scheduled')
    expect(describeSchedule({ interval: null, ...at() })).toBe('not scheduled')
    expect(describeSchedule({ interval: 0, ...at() })).toBe('not scheduled')
  })
})

describe('scheduleIntervalMs', () => {
  it('converts to milliseconds, and refuses a schedule that is not one', () => {
    expect(scheduleIntervalMs({ interval: 300, ...at() })).toBe(300_000)
    expect(scheduleIntervalMs(null)).toBeNull()
    expect(scheduleIntervalMs({ interval: -1, ...at() })).toBeNull()
  })
})

describe('isOverdue', () => {
  const now = new Date('2026-07-24T12:00:00Z').getTime()
  const query = (retrievedAt: string, interval: number) => ({
    id: 1,
    name: 'Ridership',
    schedule: { interval, ...at() },
    retrieved_at: retrievedAt,
  })

  it('leaves a query that ran within two intervals alone', () => {
    expect(isOverdue(query('2026-07-24T11:52:00Z', 300), now)).toBe(false)
  })

  it('flags a query that has missed more than two intervals', () => {
    expect(isOverdue(query('2026-07-21T12:00:00Z', 300), now)).toBe(true)
  })

  it('treats a schedule that has never produced a result as overdue', () => {
    expect(isOverdue(query('', 300), now)).toBe(true)
    expect(isOverdue(query('not a date', 300), now)).toBe(true)
  })

  it('says nothing about a query with no schedule', () => {
    expect(isOverdue({ id: 1, name: 'Ad hoc', schedule: null, retrieved_at: '' }, now)).toBe(false)
  })
})

describe('hasExpired', () => {
  const now = new Date('2026-07-24T12:00:00Z').getTime()

  it('is expired once the until date has passed', () => {
    expect(hasExpired({ interval: 300, ...at(null, null, '2026-01-01T00:00:00Z') }, now)).toBe(true)
  })

  it('is not expired before then, or with no until at all', () => {
    expect(hasExpired({ interval: 300, ...at(null, null, '2027-01-01T00:00:00Z') }, now)).toBe(false)
    expect(hasExpired({ interval: 300, ...at() }, now)).toBe(false)
    expect(hasExpired(null, now)).toBe(false)
  })

  it('does not call an unparseable until date expired', () => {
    expect(hasExpired({ interval: 300, ...at(null, null, 'soon') }, now)).toBe(false)
  })
})
