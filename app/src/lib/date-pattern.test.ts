import { describe, expect, it } from 'vitest'
import {
  formatUtcPattern,
  withoutDay,
  withoutSeconds,
  withoutYear,
  withSeconds,
  yearOnly,
} from './date-pattern'

// Every date and time pattern Settings > Formats can store
// (format-settings.tsx's DATE_FORMATS and TIME_FORMATS). The reshaping below is
// asserted against all of them rather than one representative, because the
// whole point is that a chart follows whichever one an operator picked.
const DATE_FORMATS = ['DD/MM/YY', 'MM/DD/YY', 'YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY']
const TIME_FORMATS = ['HH:mm', 'HH:mm:ss', 'hh:mm A', 'hh:mm:ss A']

describe('withoutYear', () => {
  it('drops the year and the separator that led into it, for every stored date format', () => {
    expect(DATE_FORMATS.map(withoutYear)).toEqual([
      'DD/MM',
      'MM/DD',
      'MM-DD',
      'DD/MM',
      'MM/DD',
    ])
  })

  it('keeps the field order the operator chose', () => {
    // The reason this reshapes the configured pattern instead of hardcoding a
    // day-and-month form: 'MM-DD' for one operator is 'DD/MM' for another, and
    // an axis that picks for them is the defect.
    expect(withoutYear('DD/MM/YYYY')).toBe('DD/MM')
    expect(withoutYear('MM/DD/YYYY')).toBe('MM/DD')
  })
})

describe('withoutDay', () => {
  it('drops the day and one separator, for every stored date format', () => {
    expect(DATE_FORMATS.map(withoutDay)).toEqual([
      'MM/YY',
      'MM/YY',
      'YYYY-MM',
      'MM/YYYY',
      'MM/YYYY',
    ])
  })
})

describe('yearOnly', () => {
  it('keeps the width the pattern asked for', () => {
    expect(DATE_FORMATS.map(yearOnly)).toEqual(['YY', 'YY', 'YYYY', 'YYYY', 'YYYY'])
  })

  it('falls back to a four-digit year for a pattern with no year at all', () => {
    expect(yearOnly('DD/MM')).toBe('YYYY')
  })
})

describe('withoutSeconds', () => {
  it('leaves a pattern that has none unchanged, and strips the rest', () => {
    expect(TIME_FORMATS.map(withoutSeconds)).toEqual([
      'HH:mm',
      'HH:mm',
      'hh:mm A',
      'hh:mm A',
    ])
  })

  it('keeps the meridiem, which is form rather than precision', () => {
    // Dropping seconds must not quietly turn a 12-hour axis into a 24-hour one.
    expect(withoutSeconds('hh:mm:ss A')).toContain('A')
  })
})

describe('withSeconds', () => {
  it('adds seconds where a pattern lacks them and leaves the rest alone', () => {
    expect(TIME_FORMATS.map(withSeconds)).toEqual([
      'HH:mm:ss',
      'HH:mm:ss',
      'hh:mm:ss A',
      'hh:mm:ss A',
    ])
  })

  it('introduces seconds with the separator the pattern already uses', () => {
    expect(withSeconds('HH.mm')).toBe('HH.mm.ss')
  })
})

describe('formatUtcPattern', () => {
  // 2026-07-25T21:05:09Z. A UTC evening, so any accidental local reading shows
  // up as a different day west of UTC and a different hour anywhere but UTC.
  const ts = Date.UTC(2026, 6, 25, 21, 5, 9)

  it('renders each stored date format off the UTC components', () => {
    expect(DATE_FORMATS.map((pattern) => formatUtcPattern(ts, pattern))).toEqual([
      '25/07/26',
      '07/25/26',
      '2026-07-25',
      '25/07/2026',
      '07/25/2026',
    ])
  })

  it('renders each stored time format, including the 12-hour ones', () => {
    expect(TIME_FORMATS.map((pattern) => formatUtcPattern(ts, pattern))).toEqual([
      '21:05',
      '21:05:09',
      '09:05 PM',
      '09:05:09 PM',
    ])
  })

  it('reads midnight and noon as 12, not 0, on a 12-hour pattern', () => {
    expect(formatUtcPattern(Date.UTC(2026, 6, 25, 0, 0), 'hh:mm A')).toBe('12:00 AM')
    expect(formatUtcPattern(Date.UTC(2026, 6, 25, 12, 0), 'hh:mm A')).toBe('12:00 PM')
  })

  it('does not shift a time that does not exist in the reader\'s own zone', () => {
    // The reason the tokens are read off the UTC components rather than off a
    // local Date rebuilt from them: 02:30 on a spring-forward morning is not a
    // local time at all in some zones, and the Date constructor moves it an
    // hour on, which would have labelled this tick 03:30.
    expect(formatUtcPattern(Date.UTC(2026, 2, 8, 2, 30), 'HH:mm')).toBe('02:30')
  })

  it('renders month names and unpadded fields for a pattern the settings UI cannot produce', () => {
    // A pattern stored by Redash itself, rather than picked from our own list.
    expect(formatUtcPattern(ts, 'MMM D, YYYY')).toBe('Jul 25, 2026')
  })

  it('returns nothing for a timestamp that is not one', () => {
    expect(formatUtcPattern(Number.NaN, 'YYYY-MM-DD')).toBe('')
  })
})
