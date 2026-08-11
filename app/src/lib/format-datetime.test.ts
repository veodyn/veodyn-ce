import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DATE_FORMAT,
  formatAgeCompact,
  formatAgeProse,
  formatCalendarDate,
  formatDate,
  formatDateTime,
  relativeAge,
  toDateFnsPattern,
} from '@/lib/format-datetime'

// Built in local time on purpose. A UTC instant renders on a different calendar
// day depending on where the test runs, and the machine's timezone is not what
// these assertions are about.
const AFTERNOON = new Date(2026, 1, 18, 14, 5, 9)

describe('toDateFnsPattern', () => {
  it('translates the moment tokens Redash stores', () => {
    expect(toDateFnsPattern('DD/MM/YY')).toBe('dd/MM/yy')
    expect(toDateFnsPattern('YYYY-MM-DD')).toBe('yyyy-MM-dd')
    expect(toDateFnsPattern('hh:mm A')).toBe('hh:mm a')
  })

  it('leaves tokens the two libraries already agree on', () => {
    expect(toDateFnsPattern('HH:mm:ss')).toBe('HH:mm:ss')
  })
})

describe('formatDate', () => {
  it('renders in the configured pattern', () => {
    expect(formatDate(AFTERNOON, 'YYYY-MM-DD')).toBe('2026-02-18')
    expect(formatDate(AFTERNOON, 'DD/MM/YY')).toBe('18/02/26')
    expect(formatDate(AFTERNOON, 'MM/DD/YYYY')).toBe('02/18/2026')
  })

  it('defaults to the same pattern the settings screen defaults to', () => {
    expect(formatDate(AFTERNOON)).toBe(formatDate(AFTERNOON, DEFAULT_DATE_FORMAT))
  })

  it('accepts an ISO string and an epoch as readily as a Date', () => {
    const iso = AFTERNOON.toISOString()
    expect(formatDate(iso, 'YYYY-MM-DD')).toBe('2026-02-18')
    expect(formatDate(AFTERNOON.getTime(), 'YYYY-MM-DD')).toBe('2026-02-18')
  })

  it('reads a date-only column without shifting it a day', () => {
    // "2026-02-18" is what a SQL date column hands back, and treating it as
    // midnight UTC would render 17/02 for anyone west of Greenwich.
    expect(formatDate('2026-02-18', 'DD/MM/YY')).toBe('18/02/26')
  })

  it('hands back a value that is not a date, rather than "Invalid Date"', () => {
    // A text column reaching this code should show what it holds.
    expect(formatDate('north gate', 'YYYY-MM-DD')).toBe('north gate')
    expect(formatDate('', 'YYYY-MM-DD')).toBe('')
    expect(formatDate(null)).toBe('')
    expect(formatDate(undefined)).toBe('')
  })

  it('falls back rather than throwing on a pattern an operator typed wrong', () => {
    // Settings takes free text for these, so an invalid pattern is reachable.
    expect(formatDate(AFTERNOON, 'ZZZZZZ')).toBe(formatDate(AFTERNOON, DEFAULT_DATE_FORMAT))
  })
})

describe('formatDateTime', () => {
  it('joins the two configured patterns', () => {
    expect(formatDateTime(AFTERNOON, 'YYYY-MM-DD', 'HH:mm')).toBe('2026-02-18 14:05')
    expect(formatDateTime(AFTERNOON, 'DD/MM/YY', 'HH:mm:ss')).toBe('18/02/26 14:05:09')
  })

  it('passes a non-date straight through, without a stray separator', () => {
    expect(formatDateTime('north gate')).toBe('north gate')
  })
})

describe('formatCalendarDate', () => {
  it('prints the day that was stored, not the day it is locally', () => {
    // A date-only value arrives as UTC midnight. Formatting it in local time
    // west of UTC rolls it back a day, so a coverage range that starts on the
    // 1st was rendered as the 31st of the month before.
    expect(formatCalendarDate('2020-06-01T00:00:00Z', 'MM/DD/YY')).toBe('06/01/20')
    expect(formatCalendarDate('2026-07-20T00:00:00Z', 'YYYY-MM-DD')).toBe('2026-07-20')
  })

  it('keeps a bare YYYY-MM-DD exactly as written, in any zone', () => {
    // date-fns parses a date-only string as LOCAL midnight, so reading UTC parts
    // off it would move it back a day west of UTC. There is no instant in this
    // input, so no zone should touch it.
    expect(formatCalendarDate('2026-02-18', 'MM/DD/YY')).toBe('02/18/26')
    expect(formatCalendarDate('2026-01-01', 'YYYY-MM-DD')).toBe('2026-01-01')
    expect(formatCalendarDate('2026-12-31', 'DD/MM/YYYY')).toBe('31/12/2026')
  })

  it('survives an instant whose zone offset differs from the formatted day', () => {
    // The old implementation added getTimezoneOffset() to the instant, which
    // broke whenever the offset at the source and the result disagreed: a DST
    // boundary, or Egypt reintroducing summer time in 2023.
    expect(formatCalendarDate('2023-04-28T00:00:00Z', 'YYYY-MM-DD')).toBe('2023-04-28')
    expect(formatCalendarDate('2026-03-08T00:30:00Z', 'YYYY-MM-DD')).toBe('2026-03-08')
    expect(formatCalendarDate('2026-11-01T00:30:00Z', 'YYYY-MM-DD')).toBe('2026-11-01')
  })

  it('passes a non-date straight through like the other formatters', () => {
    expect(formatCalendarDate('not a date')).toBe('not a date')
    expect(formatCalendarDate(null)).toBe('')
  })
})

describe('relativeAge', () => {
  const NOW = Date.parse('2026-07-24T12:00:00Z')
  const ago = (ms: number) => new Date(NOW - ms).toISOString()
  const DAY = 86_400_000

  it('counts in days right up to the 30 day boundary', () => {
    expect(relativeAge(ago(29 * DAY), NOW)).toEqual({ value: 29, unit: 'day' })
  })

  it('does not promote a unit half a step early', () => {
    // The thresholds used to be compared against rounded values, so 29 days and
    // 12 hours rounded up to 30 days and printed as "1 month".
    expect(relativeAge(ago(29.5 * DAY), NOW)).toEqual({ value: 29, unit: 'day' })
    expect(relativeAge(ago(23.6 * 3_600_000), NOW).unit).toBe('hour')
    expect(relativeAge(ago(59.6 * 60_000), NOW).unit).toBe('minute')
  })

  it('never prints a number that has reached the next unit boundary', () => {
    // "30 days ago" contradicts a ladder where 30 days is a month.
    for (const days of [29, 29.2, 29.9]) {
      const age = relativeAge(ago(days * DAY), NOW)
      expect(age.unit).toBe('day')
      expect(age.value).toBeLessThan(30)
    }
  })

  it('reads an unparseable timestamp as never, not as recent', () => {
    // relativeAge folded invalid into the same state as "a moment ago", which
    // turned <TimeAgo date="not a date" /> from Never into just now.
    expect(relativeAge('not a date', NOW).unit).toBe('never')
    expect(formatAgeProse('not a date', NOW)).toBe('Never')
    expect(formatAgeProse(null, NOW)).toBe('Never')
    expect(formatAgeCompact('not a date', NOW)).toBe('never')
  })

  it('switches to months at 30 days and stays there below a year', () => {
    expect(relativeAge(ago(30 * DAY), NOW).unit).toBe('month')
    // Floored, so this is 6 whole months elapsed rather than a round to the
    // nearest. 200 days is 6.6 months; claiming 7 overstates it.
    expect(relativeAge(ago(200 * DAY), NOW)).toEqual({ value: 6, unit: 'month' })
  })

  it('switches to years once the month count would reach twelve', () => {
    expect(relativeAge(ago(400 * DAY), NOW)).toEqual({ value: 1, unit: 'year' })
  })

  it('renders the one ladder in both a dense and a prose voice', () => {
    // The bug this replaced: widget chrome capped at days and said "129d ago"
    // while the prose beside it said "4 months ago" for the same instant.
    expect(formatAgeCompact(ago(129 * DAY), NOW)).toBe('4mo ago')
    expect(formatAgeProse(ago(129 * DAY), NOW)).toBe('4 months ago')
    expect(formatAgeProse(ago(DAY), NOW)).toBe('1 day ago')
  })
})
