import { describe, expect, it } from 'vitest'
import { formatQuerySchedule } from '@/lib/format-schedule'
import type { QuerySchedule } from '@/lib/query-schedule'

const NOW = Date.parse('2026-07-27T12:00:00Z')

function schedule(partial: Partial<QuerySchedule>): QuerySchedule {
  return { interval: null, time: null, day_of_week: null, until: null, ...partial }
}

// Every value the Schedule dialog can write, so the seconds ladder is checked
// end to end rather than at one convenient rung. The phrases are compared whole
// on purpose: "Refreshes every 15 minutes" contains "every 15", and so does
// "Refreshes every 15 hours".
const DIALOG_INTERVALS: [number, string][] = [
  [60, 'Refreshes every minute'],
  [300, 'Refreshes every 5 minutes'],
  [600, 'Refreshes every 10 minutes'],
  [900, 'Refreshes every 15 minutes'],
  [1800, 'Refreshes every 30 minutes'],
  [3600, 'Refreshes every hour'],
  [7200, 'Refreshes every 2 hours'],
  [10800, 'Refreshes every 3 hours'],
  [21600, 'Refreshes every 6 hours'],
  [43200, 'Refreshes every 12 hours'],
]

describe('formatQuerySchedule', () => {
  it('says nothing at all when there is no schedule', () => {
    // The header row is already busy, so an unscheduled query gets no chip.
    expect(formatQuerySchedule(null, NOW)).toBeNull()
    expect(formatQuerySchedule(undefined, NOW)).toBeNull()
  })

  it('treats a zero or absent interval as unscheduled, which is how Redash spells never', () => {
    expect(formatQuerySchedule(schedule({ interval: 0 }), NOW)).toBeNull()
    expect(formatQuerySchedule(schedule({ interval: null }), NOW)).toBeNull()
    // A leftover time or until does not make a schedule out of no interval.
    expect(formatQuerySchedule(schedule({ interval: 0, time: '06:00' }), NOW)).toBeNull()
  })

  it.each(DIALOG_INTERVALS)('reads %i seconds as its own phrase', (interval, expected) => {
    expect(formatQuerySchedule(schedule({ interval }), NOW)).toEqual({
      text: expected,
      ended: false,
    })
  })

  it('reads the interval in seconds, not minutes', () => {
    // 900 is fifteen minutes. Reading the field as minutes would call it
    // fifteen hours, and both phrases look plausible on their own.
    expect(formatQuerySchedule(schedule({ interval: 900 }), NOW)?.text).toBe(
      'Refreshes every 15 minutes'
    )
    expect(formatQuerySchedule(schedule({ interval: 60 }), NOW)?.text).toBe(
      'Refreshes every minute'
    )
  })

  it('adds the time of day a daily schedule runs at', () => {
    expect(formatQuerySchedule(schedule({ interval: 86400, time: '06:00' }), NOW)).toEqual({
      text: 'Refreshes daily at 06:00',
      ended: false,
    })
    expect(formatQuerySchedule(schedule({ interval: 86400, time: '23:30' }), NOW)?.text).toBe(
      'Refreshes daily at 23:30'
    )
    // Redash can store a daily schedule with no time set.
    expect(formatQuerySchedule(schedule({ interval: 86400 }), NOW)?.text).toBe('Refreshes daily')
  })

  it('adds the day a weekly schedule runs on', () => {
    expect(
      formatQuerySchedule(
        schedule({ interval: 604800, time: '06:00', day_of_week: 'Monday' }),
        NOW
      )
    ).toEqual({ text: 'Refreshes weekly on Monday at 06:00', ended: false })
    // The day has to come from the field, not from a default.
    expect(
      formatQuerySchedule(
        schedule({ interval: 604800, time: '06:00', day_of_week: 'Thursday' }),
        NOW
      )?.text
    ).toBe('Refreshes weekly on Thursday at 06:00')
  })

  it('phrases an interval the dialog never offers in a unit a person uses', () => {
    // The backend accepts any integer, and "every 4500 seconds" is not an
    // answer to how often this runs.
    expect(formatQuerySchedule(schedule({ interval: 4500 }), NOW)?.text).toBe(
      'Refreshes every 75 minutes'
    )
    expect(formatQuerySchedule(schedule({ interval: 45 }), NOW)?.text).toBe(
      'Refreshes every 45 seconds'
    )
    expect(formatQuerySchedule(schedule({ interval: 14400 }), NOW)?.text).toBe(
      'Refreshes every 4 hours'
    )
    expect(formatQuerySchedule(schedule({ interval: 172800, time: '06:00' }), NOW)?.text).toBe(
      'Refreshes every 2 days at 06:00'
    )
    expect(
      formatQuerySchedule(schedule({ interval: 1209600, day_of_week: 'Friday' }), NOW)?.text
    ).toBe('Refreshes every 2 weeks on Friday')
  })

  it('reports a schedule whose until has passed as ended, not as live', () => {
    // The interval is still set on an expired schedule, so describing it would
    // promise a refresh that is never coming.
    expect(
      formatQuerySchedule(schedule({ interval: 900, until: '2026-07-01' }), NOW)
    ).toEqual({ text: 'Schedule ended 07/01/26', ended: true })
  })

  it('keeps describing a schedule whose until is still ahead', () => {
    const ahead = formatQuerySchedule(schedule({ interval: 900, until: '2026-08-01' }), NOW)
    expect(ahead).toEqual({ text: 'Refreshes every 15 minutes', ended: false })
  })

  it('measures until against the clock it was handed, not a fixed date', () => {
    // Same schedule, read on either side of its end date.
    const ending = schedule({ interval: 3600, until: '2026-07-27' })
    expect(formatQuerySchedule(ending, Date.parse('2026-07-26T12:00:00Z'))?.ended).toBe(false)
    expect(formatQuerySchedule(ending, Date.parse('2026-07-28T12:00:00Z'))?.ended).toBe(true)
  })

  it('falls back to describing the schedule when until is not a date', () => {
    // An unreadable bound is not evidence the schedule stopped.
    expect(formatQuerySchedule(schedule({ interval: 3600, until: 'someday' }), NOW)).toEqual({
      text: 'Refreshes every hour',
      ended: false,
    })
  })
})
