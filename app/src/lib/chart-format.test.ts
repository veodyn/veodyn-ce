import { describe, expect, it } from 'vitest'

import {
  detectDateColumn,
  formatAutoDetectNumber,
  formatCompactNumber,
  formatDateLabel,
  formatExactNumber,
  formatLabelValue,
  formatRelativeTime,
  parseDateValue,
  sortRowsByDateX,
} from '@/lib/chart-format'

describe('formatCompactNumber', () => {
  it('abbreviates thousands/millions/billions', () => {
    expect(formatCompactNumber(1500)).toBe('1.5K')
    expect(formatCompactNumber(2_000_000)).toBe('2.0M')
    expect(formatCompactNumber(3_400_000_000)).toBe('3.4B')
  })

  it('drops the decimal for large magnitudes (>= 100x threshold)', () => {
    expect(formatCompactNumber(250_000)).toBe('250K')
  })

  it('passes non-finite values through as strings', () => {
    expect(formatCompactNumber(Number.NaN)).toBe('NaN')
  })
})

describe('formatExactNumber', () => {
  it('prints an integer bare, no decimals', () => {
    expect(formatExactNumber(12)).toBe('12')
    expect(formatExactNumber(1_000_000)).toBe('1000000')
    expect(formatExactNumber(0)).toBe('0')
  })

  it('bounds a repeating decimal to 2 places for a value >= 1', () => {
    // 10 + 20 + 25, divided by 3: the exact 'avg' fixture this function was
    // added for.
    expect(formatExactNumber(55 / 3)).toBe('18.33')
  })

  it('does not collapse a small fraction to "0.00"', () => {
    // A flat toFixed(2) turns 0.004 into "0.00", the one place this value
    // survives at all once density hides the cell's own printed text.
    expect(formatExactNumber(0.004)).toBe('0.0040')
    expect(formatExactNumber(0.0004)).toBe('0.00040')
    expect(formatExactNumber(-0.004)).toBe('-0.0040')
  })

  it('still bounds an ordinary fraction under 1 to 2 significant digits', () => {
    expect(formatExactNumber(0.5)).toBe('0.50')
  })

  it('keeps a value too small for toFixed readable as a number, not as zero', () => {
    // toFixed throws for any argument outside 0-100 digits, and the leading-
    // zero formula asks for more than 100 decimals somewhere around 1e-99.
    // Clamping the digit count avoided the throw but printed "0." followed by
    // 100 zeros, so a non-zero value read as exactly zero in the one string
    // built to carry the exact value. The assertion is on the VALUE the
    // string parses back to, not on any particular notation, so a different
    // (but still lossless) rendering of the same number would pass too.
    expect(() => formatExactNumber(1e-120)).not.toThrow()
    // 1e-120 needs only one significant digit, so a bounded-precision
    // rendering of it is still exact and can be compared as a number.
    expect(Number(formatExactNumber(1e-120))).toBe(1e-120)
    expect(Number(formatExactNumber(-2.5e-120))).toBe(-2.5e-120)
  })

  it('passes non-finite values through as strings', () => {
    expect(formatExactNumber(Number.NaN)).toBe('NaN')
  })
})

describe('formatAutoDetectNumber', () => {
  it('returns a dash for null/empty', () => {
    expect(formatAutoDetectNumber(null)).toBe('-')
    expect(formatAutoDetectNumber('')).toBe('-')
  })

  it('applies prefix, suffix, and fixed decimals', () => {
    expect(formatAutoDetectNumber(1234.5, { prefix: '$', suffix: ' USD', decimals: 2 })).toBe('$1,234.50 USD')
  })

  it('returns the raw string for non-numeric input', () => {
    expect(formatAutoDetectNumber('n/a')).toBe('n/a')
  })
})

describe('parseDateValue', () => {
  it('treats a naive ISO string as UTC', () => {
    expect(parseDateValue('2026-03-19T08:00:00')).toBe(Date.parse('2026-03-19T08:00:00Z'))
  })

  it('reads a space-separated ClickHouse timestamp as UTC too', () => {
    expect(parseDateValue('2026-07-22 15:22:25.919')).toBe(Date.parse('2026-07-22T15:22:25.919Z'))
  })

  it('passes through numbers and Dates, null for garbage', () => {
    const date = new Date('2026-03-19T08:00:00Z')

    expect(parseDateValue(123)).toBe(123)
    expect(parseDateValue(date)).toBe(date.getTime())
    expect(parseDateValue('not a date')).toBeNull()
  })
})

describe('sortRowsByDateX', () => {
  it('orders rows by the parsed date column', () => {
    const rows = [{ d: '2026-01-02' }, { d: '2026-01-01' }]

    expect(sortRowsByDateX(rows, 'd')).toEqual([{ d: '2026-01-01' }, { d: '2026-01-02' }])
  })

  it('returns the input unchanged when any value is unparseable', () => {
    const rows = [{ d: 'x' }, { d: '2026-01-01' }]

    expect(sortRowsByDateX(rows, 'd')).toBe(rows)
  })
})

describe('formatDateLabel', () => {
  const ISO_LIKE = { dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm' }
  const US_TWELVE_HOUR = { dateFormat: 'MM/DD/YY', timeFormat: 'hh:mm A' }

  it('formats date-only vs datetime', () => {
    expect(formatDateLabel('2026-03-19', false, ISO_LIKE)).toBe('2026-03-19')
    expect(formatDateLabel('2026-03-19T08:30:00', true, ISO_LIKE)).toBe('2026-03-19 08:30')
  })

  it('writes the label in the configured format, since a tooltip is a value like any other', () => {
    expect(formatDateLabel('2026-03-19T08:30:00', true, US_TWELVE_HOUR)).toBe('03/19/26 08:30 AM')
  })

  it('keeps seconds when the value has them, so sub-minute points stay distinct', () => {
    expect(formatDateLabel('2026-07-22 15:22:25.919', true, ISO_LIKE)).toBe('2026-07-22 15:22:25')
  })

  it('adds seconds the configured format would have hidden, rather than rounding the instant away', () => {
    // A tooltip is the one place a reader gets the exact value, so a format
    // without seconds must not silently turn 15:22:25 into 15:22.
    expect(formatDateLabel('2026-07-22 15:22:25.919', true, US_TWELVE_HOUR)).toBe('07/22/26 03:22:25 PM')
  })
})

describe('detectDateColumn', () => {
  it('accepts a ClickHouse DateTime64 column that arrives typed as a string', () => {
    expect(detectDateColumn(['2026-07-22 15:22:25.919', '2026-07-22 15:23:11.004'])).toEqual({
      isDate: true,
      hasTime: true,
    })
  })

  it('reports date-only values as having no time component', () => {
    expect(detectDateColumn(['2026-07-22', '2026-07-23'])).toEqual({ isDate: true, hasTime: false })
  })

  it('ignores nulls but still reads the values around them', () => {
    expect(detectDateColumn([null, '2026-07-22', ''])).toEqual({ isDate: true, hasTime: false })
  })

  it('rejects numbers, so an integer column is not mistaken for epochs', () => {
    expect(detectDateColumn([1_700_000_000, 1_700_000_001]).isDate).toBe(false)
  })

  it('rejects a column where any value is not a date', () => {
    expect(detectDateColumn(['2026-07-22', 'n/a']).isDate).toBe(false)
    expect(detectDateColumn([]).isDate).toBe(false)
  })
})

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-03-19T12:00:00Z')

  it('buckets by elapsed time using the passed now', () => {
    expect(formatRelativeTime(null, now)).toBe('never')
    expect(formatRelativeTime('2026-03-19T11:59:55Z', now)).toBe('just now')
    expect(formatRelativeTime('2026-03-19T11:30:00Z', now)).toBe('30m ago')
    expect(formatRelativeTime('2026-03-18T12:00:00Z', now)).toBe('1d ago')
  })
})

describe('formatLabelValue', () => {
  it('compact-formats numbers, stringifies the rest, empty for null', () => {
    expect(formatLabelValue(1500)).toBe('1.5K')
    expect(formatLabelValue('hi')).toBe('hi')
    expect(formatLabelValue(null)).toBe('')
  })
})
