/**
 * The wire contract for date parameters, which the Redash fork defines and the
 * backend enforces:
 *
 * - a range is sent as `{ start, end }` (redash/models/parameterized_query.py
 *   `_is_date_range` reads exactly those two keys), formatted per parameter type
 *   (DateRangeParameter.js DATETIME_FORMATS);
 * - a dynamic value is *stored* as the sentinel `d_<key>` but *sent* resolved to
 *   concrete dates, because Redash resolves it in `getExecutionValue()`, which
 *   runs per execution. "Last 7 days" therefore has to mean the seven days
 *   before the run, not before the click that selected it.
 */
import { describe, expect, it } from 'vitest'
import {
  DYNAMIC_DATE_RANGES,
  DYNAMIC_DATES,
  isDynamicValue,
  resolveParameterValue,
  sameParameterValue,
} from './dynamic-dates'

// A fixed instant so every expectation is exact: a Wednesday, mid-afternoon.
// Built from local components rather than a `Z` literal on purpose. Formatting
// is local, the suite pins no TZ, and an instant expressed in UTC lands on a
// different local clock time (and sometimes a different day) depending on where
// this runs, which would make every expectation below machine-dependent.
const NOW = new Date(2026, 6, 15, 14, 30, 45)

describe('resolveParameterValue for ranges', () => {
  it('resolves a calendar preset to the whole of that day', () => {
    expect(resolveParameterValue('date-range', 'd_today', NOW)).toEqual({
      start: '2026-07-15',
      end: '2026-07-15',
    })
  })

  it('resolves a rolling preset to a window ending now', () => {
    expect(resolveParameterValue('date-range', 'd_last_7_days', NOW)).toEqual({
      start: '2026-07-08',
      end: '2026-07-15',
    })
  })

  // The whole point of a dynamic value: the same stored sentinel has to produce
  // a different window on a later run.
  it('resolves against the run time, not a stored instant', () => {
    const later = new Date(2026, 7, 1, 9, 0, 0)

    expect(resolveParameterValue('date-range', 'd_last_7_days', later)).toEqual({
      start: '2026-07-25',
      end: '2026-08-01',
    })
  })

  it('formats to the precision the parameter type asks for', () => {
    expect(resolveParameterValue('datetime-range', 'd_today', NOW)).toEqual({
      start: '2026-07-15 00:00',
      end: '2026-07-15 23:59',
    })
    expect(resolveParameterValue('datetime-range-with-seconds', 'd_today', NOW)).toEqual({
      start: '2026-07-15 00:00:00',
      end: '2026-07-15 23:59:59',
    })
  })

  // A hand-picked range is already in wire shape and must survive untouched.
  it('passes a concrete range through', () => {
    const picked = { start: '2026-01-01', end: '2026-01-31' }

    expect(resolveParameterValue('date-range', picked, NOW)).toEqual(picked)
  })

  it('resolves the month and year presets to calendar boundaries', () => {
    expect(resolveParameterValue('date-range', 'd_this_month', NOW)).toEqual({
      start: '2026-07-01',
      end: '2026-07-31',
    })
    expect(resolveParameterValue('date-range', 'd_last_month', NOW)).toEqual({
      start: '2026-06-01',
      end: '2026-06-30',
    })
  })
})

describe('resolveParameterValue for single dates', () => {
  it('resolves the now sentinel', () => {
    expect(resolveParameterValue('date', 'd_now', NOW)).toBe('2026-07-15')
    expect(resolveParameterValue('datetime-local', 'd_now', NOW)).toBe('2026-07-15 14:30')
    expect(resolveParameterValue('datetime-with-seconds', 'd_now', NOW)).toBe('2026-07-15 14:30:45')
  })

  it('resolves the yesterday sentinel', () => {
    expect(resolveParameterValue('date', 'd_yesterday', NOW)).toBe('2026-07-14')
  })

  it('passes a concrete date through', () => {
    expect(resolveParameterValue('date', '2026-03-09', NOW)).toBe('2026-03-09')
  })
})

describe('resolveParameterValue leaves other types alone', () => {
  it('does not touch a text or number value', () => {
    expect(resolveParameterValue('text', 'route 12', NOW)).toBe('route 12')
    expect(resolveParameterValue('number', 7, NOW)).toBe(7)
  })

  // A `d_`-looking string on a non-date parameter is just a string. Resolving it
  // would corrupt a legitimate text value.
  it('does not resolve a sentinel-shaped text value', () => {
    expect(resolveParameterValue('text', 'd_today', NOW)).toBe('d_today')
  })

  it('does not resolve an unknown sentinel on a date parameter', () => {
    expect(resolveParameterValue('date-range', 'd_since_forever', NOW)).toBe('d_since_forever')
  })
})

describe('sameParameterValue', () => {
  it('compares scalars by value', () => {
    expect(sameParameterValue('a', 'a')).toBe(true)
    expect(sameParameterValue(7, 7)).toBe(true)
    expect(sameParameterValue('a', 'b')).toBe(false)
  })

  it('compares a range by its dates rather than by identity', () => {
    expect(
      sameParameterValue({ start: '2026-01-01', end: '2026-01-31' }, { start: '2026-01-01', end: '2026-01-31' })
    ).toBe(true)
    expect(
      sameParameterValue({ start: '2026-01-01', end: '2026-01-31' }, { start: '2026-01-02', end: '2026-01-31' })
    ).toBe(false)
  })

  // A multi-value parameter holds a list, so identity would report every render
  // as an edit and leave the run blocked with nothing to apply.
  it('compares a list by its contents, in order', () => {
    expect(sameParameterValue(['Open', 'Closed'], ['Open', 'Closed'])).toBe(true)
    expect(sameParameterValue(['Open'], ['Open', 'Closed'])).toBe(false)
    expect(sameParameterValue(['Open', 'Closed'], ['Closed', 'Open'])).toBe(false)
    expect(sameParameterValue([], [])).toBe(true)
  })
})

describe('isDynamicValue', () => {
  it('recognises known sentinels only', () => {
    expect(isDynamicValue('d_today')).toBe(true)
    expect(isDynamicValue('d_now')).toBe(true)
    expect(isDynamicValue('d_since_forever')).toBe(false)
    expect(isDynamicValue('2026-07-15')).toBe(false)
    expect(isDynamicValue({ start: 'a', end: 'b' })).toBe(false)
  })
})

describe('the preset tables', () => {
  // The picker renders these, and the sentinel is what gets stored, so a key
  // that does not round-trip through resolveParameterValue is a dead option.
  it('every range preset resolves to a concrete range', () => {
    for (const preset of DYNAMIC_DATE_RANGES) {
      const resolved = resolveParameterValue('date-range', `d_${preset.key}`, NOW)

      expect(resolved, preset.key).toMatchObject({
        start: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        end: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      })
    }
  })

  it('every single-date preset resolves to a concrete date', () => {
    for (const preset of DYNAMIC_DATES) {
      expect(resolveParameterValue('date', `d_${preset.key}`, NOW), preset.key).toMatch(
        /^\d{4}-\d{2}-\d{2}$/
      )
    }
  })

  it('carries the names Redash shows', () => {
    expect(DYNAMIC_DATE_RANGES.map((p) => p.key)).toContain('last_30_days')
    expect(DYNAMIC_DATE_RANGES.find((p) => p.key === 'last_30_days')?.name).toBe('Last 30 days')
    expect(DYNAMIC_DATES.find((p) => p.key === 'now')?.name).toBe('Today/Now')
  })
})
