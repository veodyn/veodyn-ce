import { isValidElement, type ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ResolvedChartConfig } from './resolve-config'
import { TimeAxisTick, X_TIME_KEY, planXAxis } from './x-axis-config'

function configFor(overrides: Partial<ResolvedChartConfig> = {}): ResolvedChartConfig {
  return {
    chartType: 'line',
    xCol: 'ts',
    yRightCols: [],
    effectiveYCols: ['value'],
    indexed: false,
    stacking: 'disabled',
    xIsDatetime: true,
    xHasTime: true,
    swappedAxes: false,
    reverseX: false,
    showDataLabels: false,
    donut: false,
    seriesOptions: {},
    yAxis: [],
    referenceLines: [],
    ...overrides,
  }
}

// The display formats the axis writes its labels in. ISO-style here, which is
// what the axis used to hardcode, so the label assertions below still describe
// the same strings; the cases that vary the setting say so.
const PATTERNS = { dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm' }

// The shape that started this: a ClickHouse DateTime64 column, one row per
// minute, whose raw cells are far too long to sit under a tick.
const rows = [
  { ts: '2026-07-22 15:22:25.919', value: 4 },
  { ts: '2026-07-22 15:38:25.919', value: 6 },
  { ts: '2026-07-22 16:04:25.919', value: 2 },
]

describe('planXAxis', () => {
  it('puts a date column on a time scale keyed off a numeric mirror column', () => {
    const plan = planXAxis(configFor(), rows, PATTERNS)

    expect(plan.props.dataKey).toBe(X_TIME_KEY)
    expect(plan.props.type).toBe('number')
    expect(plan.props.scale).toBe('time')
    expect(plan.props.domain).toEqual(['dataMin', 'dataMax'])
  })

  it('hands the planned ticks to the tick renderer', () => {
    // The renderer decides whether the first tick's date line is about to be
    // superseded by the next tick's, which it can only do if it can see the
    // ticks. Getting the rule right and forgetting to pass them looks exactly
    // like the bug it fixes, and every rendered assertion still passes.
    const plan = planXAxis(configFor(), rows, PATTERNS)
    const tick = plan.props.tick as ReactElement<{ ticks?: number[] }>

    expect(isValidElement(tick)).toBe(true)
    expect(tick.props.ticks).toEqual(plan.props.ticks)
  })

  it('mirrors each row onto an epoch without disturbing the original value', () => {
    const plan = planXAxis(configFor(), rows, PATTERNS)

    expect(plan.data[0][X_TIME_KEY]).toBe(Date.parse('2026-07-22T15:22:25.919Z'))
    expect(plan.data[0].ts).toBe('2026-07-22 15:22:25.919')
    expect(rows[0]).not.toHaveProperty(X_TIME_KEY)
  })

  it('places ticks on round boundaries instead of on the first row s timestamp', () => {
    const plan = planXAxis(configFor(), rows, PATTERNS)
    const labels = (plan.props.ticks as number[]).map((t) => new Date(t).toISOString())

    expect(labels.length).toBeGreaterThan(1)
    expect(labels.every((iso) => iso.endsWith(':00.000Z'))).toBe(true)
  })

  it('maps an annotation timestamp into the axis coordinate space', () => {
    const plan = planXAxis(configFor(), rows, PATTERNS)

    expect(plan.toAxisValue('2026-07-22 15:38:25.919')).toBe(Date.parse('2026-07-22T15:38:25.919Z'))
    expect(plan.toAxisValue('not a date')).toBeUndefined()
  })

  it('stays categorical when a value in the column will not parse', () => {
    const plan = planXAxis(configFor(), [...rows, { ts: 'unknown', value: 1 }], PATTERNS)

    expect(plan.props.dataKey).toBe('ts')
    expect(plan.props.type).toBeUndefined()
    expect(plan.data[0]).not.toHaveProperty(X_TIME_KEY)
  })

  it('leaves a non-date column alone', () => {
    const plan = planXAxis(configFor({ xIsDatetime: false, xCol: 'name' }), [{ name: 'a', value: 1 }], PATTERNS)

    expect(plan.props.dataKey).toBe('name')
    expect(plan.props.tickFormatter).toBeUndefined()
    expect(plan.props.interval).toBe('preserveStartEnd')
  })

  it('keeps bars on category bands but shortens their tick labels', () => {
    const plan = planXAxis(configFor({ chartType: 'bar' }), rows, PATTERNS, { categorical: true })
    const format = plan.props.tickFormatter as (value: unknown) => string

    expect(plan.props.dataKey).toBe('ts')
    expect(plan.props.type).toBeUndefined()
    expect(format('2026-07-22 15:22:25.919')).toBe('15:22')
  })

  it('measures a tick at the width the configured format actually draws', () => {
    // recharts decides which labels fit by running tickFormatter over the raw
    // value, so this formatter and the tick element have to agree. A 12-hour
    // format is three characters wider than the 24-hour one, and measuring the
    // narrower form packs the axis tighter than it draws.
    const plan = planXAxis(configFor(), rows, { dateFormat: 'MM/DD/YY', timeFormat: 'hh:mm A' })
    const format = plan.props.tickFormatter as (value: unknown) => string

    expect(format('2026-07-22 15:22:25.919')).toBe('03:22 PM')
  })

  it('labels daily data by date, not by the midnight it happens to fall on', () => {
    // Three daily bars span two days, which is short enough that a purely
    // span-driven step would ask for hours and print "00:00" three times.
    const daily = [
      { ts: '2026-03-17', value: 1 },
      { ts: '2026-03-18', value: 2 },
      { ts: '2026-03-19', value: 3 },
    ]
    const plan = planXAxis(configFor({ xHasTime: false }), daily, PATTERNS, { categorical: true })
    const format = plan.props.tickFormatter as (value: unknown) => string

    expect(format('2026-03-18')).toBe('03-18')
  })

  it('handles an empty result without inventing an axis', () => {
    const plan = planXAxis(configFor(), [], PATTERNS)

    expect(plan.props.dataKey).toBe('ts')
    expect(plan.data).toEqual([])
  })
})

describe('TimeAxisTick', () => {
  const midnight = Date.parse('2026-07-23T00:00:00Z')
  const midMorning = Date.parse('2026-07-23T06:00:00Z')

  function renderTick(
    value: number,
    index: number,
    ticks?: number[],
    patterns: { dateFormat: string; timeFormat: string } = PATTERNS,
  ) {
    return render(
      <svg>
        <TimeAxisTick
          granularity="minute"
          patterns={patterns}
          ticks={ticks}
          x={100}
          y={0}
          index={index}
          payload={{ value }}
        />
      </svg>,
    )
  }

  it('states the date under the first tick', () => {
    renderTick(midMorning, 0)

    expect(screen.getByText('06:00')).toBeInTheDocument()
    expect(screen.getByText('2026-07-23')).toBeInTheDocument()
  })

  it('repeats the date only where the day changes', () => {
    renderTick(midnight, 4)

    expect(screen.getByText('00:00')).toBeInTheDocument()
    expect(screen.getByText('2026-07-23')).toBeInTheDocument()
  })

  it('leaves the date off every other tick, so labels cannot collide', () => {
    renderTick(midMorning, 4)

    expect(screen.getByText('06:00')).toBeInTheDocument()
    expect(screen.queryByText('2026-07-23')).not.toBeInTheDocument()
  })

  it('drops the first tick date when the very next tick states its own', () => {
    // The reported axis. A window opening at 21:00 puts the first tick one
    // step before midnight, so two ten-character dates landed a single tick
    // gap apart and overprinted into "2026-07-2026-07-25". The first one is
    // superseded before a label's width has passed, so it says nothing the
    // next tick is not about to say better.
    const evening = Date.parse('2026-07-24T21:00:00Z')
    const nextMidnight = Date.parse('2026-07-25T00:00:00Z')

    renderTick(evening, 0, [evening, nextMidnight])

    expect(screen.getByText('21:00')).toBeInTheDocument()
    expect(screen.queryByText('2026-07-24')).not.toBeInTheDocument()
  })

  it('keeps the first tick date when the next tick is an ordinary one', () => {
    // The other half of the same rule. Suppressing here would leave an axis of
    // bare clock times with no day attached anywhere on it.
    const evening = Date.parse('2026-07-24T21:00:00Z')
    const laterSameDay = Date.parse('2026-07-24T22:00:00Z')

    renderTick(evening, 0, [evening, laterSameDay])

    expect(screen.getByText('2026-07-24')).toBeInTheDocument()
  })

  it('still states the date at a day change that is not the first tick', () => {
    const evening = Date.parse('2026-07-24T21:00:00Z')
    const nextMidnight = Date.parse('2026-07-25T00:00:00Z')

    renderTick(nextMidnight, 1, [evening, nextMidnight])

    expect(screen.getByText('2026-07-25')).toBeInTheDocument()
  })

  it('writes both its lines in the configured formats', () => {
    // The axis and the date line under it are one label in two parts, so a
    // setting that changes either has to change both. This is the whole request:
    // the reported axis read "21:00" over "2026-07-25" for an operator whose
    // every other date read 07/25/26.
    renderTick(Date.parse('2026-07-24T21:00:00Z'), 0, undefined, {
      dateFormat: 'MM/DD/YY',
      timeFormat: 'hh:mm A',
    })

    expect(screen.getByText('09:00 PM')).toBeInTheDocument()
    expect(screen.getByText('07/24/26')).toBeInTheDocument()
  })
})
