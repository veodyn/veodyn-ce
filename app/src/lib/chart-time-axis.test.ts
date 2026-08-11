import { describe, expect, it } from 'vitest'
import {
  contextFor,
  formatDateContext,
  formatDateTick,
  granularityForStep,
  niceTimeTicks,
  smallestGap,
  startsContextPeriod,
} from '@/lib/chart-time-axis'

const iso = (value: string) => Date.parse(value)
const asIso = (ts: number) => new Date(ts).toISOString()

describe('niceTimeTicks', () => {
  it('lands ticks on round boundaries, not on the domain edges', () => {
    // The complaint this whole module answers: a domain that starts at an
    // arbitrary instant must not label every tick with that instant's offset.
    const ticks = niceTimeTicks(iso('2026-07-22T15:22:25.919Z'), iso('2026-07-22T16:22:25.919Z'))

    expect(ticks.map(asIso)).toEqual([
      '2026-07-22T15:30:00.000Z',
      '2026-07-22T15:45:00.000Z',
      '2026-07-22T16:00:00.000Z',
      '2026-07-22T16:15:00.000Z',
    ])
  })

  it('steps a day-long span in hours', () => {
    const ticks = niceTimeTicks(iso('2026-07-22T00:00:00Z'), iso('2026-07-23T00:00:00Z'))

    expect(ticks).toHaveLength(9)
    expect(asIso(ticks[1])).toBe('2026-07-22T03:00:00.000Z')
  })

  it('keeps multi-day steps on UTC midnight', () => {
    const ticks = niceTimeTicks(iso('2026-01-05T09:30:00Z'), iso('2026-02-20T09:30:00Z'))

    expect(ticks.every((t) => asIso(t).endsWith('T00:00:00.000Z'))).toBe(true)
  })

  it('aligns a multi-month step to calendar quarters', () => {
    const ticks = niceTimeTicks(iso('2026-01-15T00:00:00Z'), iso('2026-12-31T00:00:00Z'))

    expect(ticks.map(asIso)).toEqual([
      '2026-04-01T00:00:00.000Z',
      '2026-07-01T00:00:00.000Z',
      '2026-10-01T00:00:00.000Z',
    ])
  })

  it('aligns a decade-scale step to round years', () => {
    const ticks = niceTimeTicks(iso('1997-06-01T00:00:00Z'), iso('2026-06-01T00:00:00Z'))

    expect(ticks.length).toBeGreaterThan(1)
    expect(ticks.map((t) => new Date(t).getUTCFullYear() % 5)).toEqual(ticks.map(() => 0))
    expect(ticks.every((t) => asIso(t).endsWith('-01-01T00:00:00.000Z'))).toBe(true)
  })

  it('never steps finer than the data resolution it is given', () => {
    // Three daily points spanning two days: an 8-tick target would ask for a
    // 6-hour step and label all three "00:00".
    const ticks = niceTimeTicks(
      iso('2026-03-17T00:00:00Z'),
      iso('2026-03-19T00:00:00Z'),
      8,
      86_400_000,
    )

    expect(ticks.map(asIso)).toEqual([
      '2026-03-17T00:00:00.000Z',
      '2026-03-18T00:00:00.000Z',
      '2026-03-19T00:00:00.000Z',
    ])
  })

  it('degenerates safely on an empty or unusable domain', () => {
    const single = iso('2026-07-22T00:00:00Z')

    expect(niceTimeTicks(single, single)).toEqual([single])
    expect(niceTimeTicks(NaN, single)).toEqual([])
  })
})

describe('smallestGap', () => {
  it('reports the finest spacing present, regardless of row order', () => {
    const hour = 3_600_000
    const base = iso('2026-03-17T00:00:00Z')

    expect(smallestGap([base + 3 * hour, base, base + hour])).toBe(hour)
  })

  it('is zero when there is nothing to measure', () => {
    expect(smallestGap([])).toBe(0)
    expect(smallestGap([5, 5, 5])).toBe(0)
  })
})

describe('granularityForStep', () => {
  it.each([
    { step: 15_000, expected: 'second' },
    { step: 15 * 60_000, expected: 'minute' },
    { step: 6 * 3_600_000, expected: 'minute' },
    { step: 86_400_000, expected: 'day' },
    { step: 30 * 86_400_000, expected: 'month' },
    { step: 730 * 86_400_000, expected: 'year' },
  ])('labels a $step ms step by $expected', ({ step, expected }) => {
    expect(granularityForStep(step)).toBe(expected)
  })
})

// Formats an operator can pick in Settings > Formats. ISO_LIKE is the form the
// axis used to hardcode, kept as a case so the old shape is still covered where
// it is now one choice among several rather than the only option.
const ISO_LIKE = { dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm' }
const EUROPEAN = { dateFormat: 'DD/MM/YYYY', timeFormat: 'HH:mm' }
const US_TWELVE_HOUR = { dateFormat: 'MM/DD/YY', timeFormat: 'hh:mm A' }

describe('formatDateTick', () => {
  const ts = iso('2026-07-22T15:22:25.919Z')

  it.each([
    { granularity: 'second', expected: '15:22:25' },
    { granularity: 'minute', expected: '15:22' },
    { granularity: 'day', expected: '07-22' },
    { granularity: 'month', expected: '2026-07' },
    { granularity: 'year', expected: '2026' },
  ] as const)('renders $granularity as $expected on an ISO-style setting', ({ granularity, expected }) => {
    expect(formatDateTick(ts, granularity, ISO_LIKE)).toBe(expected)
  })

  it('writes the day in the order the setting asks for', () => {
    // The defect this closes: an operator picks DD/MM/YYYY, every table in the
    // product follows it, and the chart axes keep printing month-first.
    expect(formatDateTick(ts, 'day', EUROPEAN)).toBe('22/07')
    expect(formatDateTick(ts, 'day', US_TWELVE_HOUR)).toBe('07/22')
  })

  it('writes the time on the clock the setting asks for', () => {
    expect(formatDateTick(ts, 'minute', US_TWELVE_HOUR)).toBe('03:22 PM')
  })

  it('keeps the meridiem but not the seconds at minute granularity', () => {
    // The rule the module follows: the setting decides the form, the axis's own
    // step decides the precision. Seconds under every tick of a minute axis are
    // always ":00", and they cost labels recharts would otherwise fit.
    const withSecondsSetting = { dateFormat: 'MM/DD/YY', timeFormat: 'hh:mm:ss A' }

    expect(formatDateTick(ts, 'minute', withSecondsSetting)).toBe('03:22 PM')
  })

  it('adds seconds a chosen format lacks when the axis steps in them', () => {
    expect(formatDateTick(ts, 'second', US_TWELVE_HOUR)).toBe('03:22:25 PM')
  })

  it('drops the year at day granularity and the day at month granularity, whatever the order', () => {
    expect(formatDateTick(ts, 'month', { dateFormat: 'DD/MM/YY', timeFormat: 'HH:mm' })).toBe('07/26')
    expect(formatDateTick(ts, 'month', EUROPEAN)).toBe('07/2026')
  })

  it('keeps the year width the setting chose', () => {
    expect(formatDateTick(ts, 'year', US_TWELVE_HOUR)).toBe('26')
    expect(formatDateTick(ts, 'year', EUROPEAN)).toBe('2026')
  })
})

describe('tick context', () => {
  it('adds a date under time-of-day labels and a year under day labels', () => {
    expect(contextFor('minute')).toBe('date')
    expect(contextFor('second')).toBe('date')
    expect(contextFor('day')).toBe('year')
    expect(contextFor('month')).toBeNull()
    expect(contextFor('year')).toBeNull()
  })

  it('only marks the boundary where the context changes', () => {
    expect(startsContextPeriod(iso('2026-07-22T00:00:00Z'), 'date')).toBe(true)
    expect(startsContextPeriod(iso('2026-07-22T06:00:00Z'), 'date')).toBe(false)
    expect(startsContextPeriod(iso('2026-01-01T00:00:00Z'), 'year')).toBe(true)
    expect(startsContextPeriod(iso('2026-07-22T00:00:00Z'), 'year')).toBe(false)
  })

  it('formats each context at its own width, in the configured format', () => {
    const ts = iso('2026-07-22T00:00:00Z')

    expect(formatDateContext(ts, 'date', ISO_LIKE)).toBe('2026-07-22')
    expect(formatDateContext(ts, 'year', ISO_LIKE)).toBe('2026')
    // The second line under a time-of-day axis is a full date, so it takes the
    // configured pattern whole rather than any reshaped form of it.
    expect(formatDateContext(ts, 'date', EUROPEAN)).toBe('22/07/2026')
    expect(formatDateContext(ts, 'date', US_TWELVE_HOUR)).toBe('07/22/26')
  })
})
