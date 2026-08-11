// The adapter half of KPI_HISTORY: everything the KPI page passes as a typed
// prop has to be recovered from an options bag and a query result here, so this
// is where the recovery is pinned.
import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import { renderWithProviders } from '@/test/utils'
import { KpiHistoryRenderer } from './kpi-history-renderer'
import {
  kpiHistoryColumns,
  kpiHistoryReadings,
  kpiHistoryTarget,
  kpiHistoryThresholds,
} from './kpi-history-model'

const data: QueryResultData = {
  columns: [
    { name: 'measured_at', friendly_name: 'Measured At', type: 'datetime' },
    { name: 'on_time_pct', friendly_name: 'On Time (%)', type: 'float' },
  ],
  rows: [
    { measured_at: '2026-03-05T06:00:00Z', on_time_pct: 91.4 },
    { measured_at: '2026-03-06T06:00:00Z', on_time_pct: 85.2 },
    { measured_at: '2026-03-07T06:00:00Z', on_time_pct: 92.3 },
  ],
}

const OPTIONS = {
  timeColumn: 'measured_at',
  valueColumn: 'on_time_pct',
  unit: '%',
  target: { value: 90, direction: 'higher-is-better' as const },
  thresholds: { atRisk: 88, breached: 82 },
}

function viz(options: Record<string, unknown>): MockVisualization {
  return {
    id: 62,
    type: 'KPI_HISTORY',
    name: 'On-Time Performance vs Target',
    description: '',
    options,
    created_at: '',
    updated_at: '',
  }
}

describe('reading the columns', () => {
  it('uses the named columns', () => {
    expect(kpiHistoryColumns(OPTIONS, data)).toEqual({
      timeColumn: 'measured_at',
      valueColumn: 'on_time_pct',
    })
  })

  // The funnel's fallback, for the same reason: a widget created from a builder
  // tile has no options at all, and an empty panel reads as a broken renderer.
  it('falls back to the first two columns when nothing is named', () => {
    expect(kpiHistoryColumns({}, data)).toEqual({
      timeColumn: 'measured_at',
      valueColumn: 'on_time_pct',
    })
  })
})

describe('reading the readings', () => {
  it('keeps the order the query returned', () => {
    expect(kpiHistoryReadings(OPTIONS, data).map((reading) => reading.value)).toEqual([
      91.4, 85.2, 92.3,
    ])
  })

  // Plotted as 0 it would draw a dip the data does not have, which is worse
  // than a shorter series: the reader cannot tell the difference.
  it('drops a row whose value is not a number rather than plotting it as zero', () => {
    const withGap: QueryResultData = {
      ...data,
      rows: [...data.rows, { measured_at: '2026-03-08T06:00:00Z', on_time_pct: null }],
    }

    expect(kpiHistoryReadings(OPTIONS, withGap)).toHaveLength(3)
  })

  it('has nothing to draw when the named column is not in the result', () => {
    expect(kpiHistoryReadings({ ...OPTIONS, valueColumn: 'missing' }, data)).toEqual([])
  })
})

// Everything Number() reads as a finite number without being one. Each of
// these drew a reading at 0 or at 1 that the reader could not tell from a real
// one, which for a chart whose whole subject is distance from a target means
// invented dips and invented threshold breaches.
describe('cells that look like readings and are not', () => {
  function readings(rows: Record<string, unknown>[]): { at: string; value: number }[] {
    return kpiHistoryReadings(OPTIONS, { columns: data.columns, rows })
  }

  it('drops a blank cell padded with whitespace rather than plotting it as zero', () => {
    expect(readings([{ measured_at: '2026-03-05T06:00:00Z', on_time_pct: '   ' }])).toEqual([])
    expect(readings([{ measured_at: '2026-03-05T06:00:00Z', on_time_pct: '\t\n' }])).toEqual([])
  })

  // Picking a boolean column is a mis-click in the editor, not a data fault,
  // and it drew a flat run of zeroes and ones under the thresholds.
  it('drops a boolean rather than plotting false as zero and true as one', () => {
    expect(readings([{ measured_at: '2026-03-05T06:00:00Z', on_time_pct: false }])).toEqual([])
    expect(readings([{ measured_at: '2026-03-05T06:00:00Z', on_time_pct: true }])).toEqual([])
  })

  it('drops a value that is text rather than a number', () => {
    expect(readings([{ measured_at: '2026-03-05T06:00:00Z', on_time_pct: 'n/a' }])).toEqual([])
  })

  // The reason strings cannot simply be refused: ClickHouse sends a Decimal as
  // one, and refusing it would empty the chart of a perfectly good column.
  it('keeps a numeric string, which is how a ClickHouse Decimal arrives', () => {
    expect(readings([{ measured_at: '2026-03-05T06:00:00Z', on_time_pct: '91.40' }])).toEqual([
      { at: '2026-03-05T06:00:00Z', value: 91.4 },
    ])
    expect(readings([{ measured_at: '2026-03-05T06:00:00Z', on_time_pct: ' -3.5 ' }])).toEqual([
      { at: '2026-03-05T06:00:00Z', value: -3.5 },
    ])
  })

  it('drops a row whose timestamp is blank rather than drawing a nameless tick', () => {
    expect(readings([{ measured_at: '  ', on_time_pct: 91.4 }])).toEqual([])
  })
})

describe('reading the target and the thresholds', () => {
  it('reads a target, defaulting the direction a bare number implies', () => {
    expect(kpiHistoryTarget({ target: { value: 90 } })).toEqual({
      value: 90,
      direction: 'higher-is-better',
    })
    expect(kpiHistoryTarget({ target: { value: 4, direction: 'lower-is-better' } })).toEqual({
      value: 4,
      direction: 'lower-is-better',
    })
  })

  it('has no target when there is no number to compare against', () => {
    expect(kpiHistoryTarget({})).toBeUndefined()
    expect(kpiHistoryTarget({ target: { direction: 'lower-is-better' } })).toBeUndefined()
  })

  // Half a pair would let statusBands clamp the missing side to the edge of the
  // domain and shade half the plot a colour nobody asked for.
  it('takes thresholds only when both bounds are real numbers', () => {
    expect(kpiHistoryThresholds({ thresholds: { atRisk: 88, breached: 82 } })).toEqual({
      atRisk: 88,
      breached: 82,
    })
    expect(kpiHistoryThresholds({ thresholds: { atRisk: 88 } })).toBeUndefined()
    expect(kpiHistoryThresholds({})).toBeUndefined()
  })
})

describe('the registered renderer', () => {
  it('draws the readings, with the target in its accessible name', () => {
    renderWithProviders(<KpiHistoryRenderer visualization={viz(OPTIONS)} data={data} />)

    const label = screen.getByRole('img').getAttribute('aria-label') ?? ''
    expect(label).toContain('3 readings')
    expect(label).toContain('Target 90%')
  })

  // Distinct from the chart's own "No readings yet", which answers the KPI
  // page's question. Here the query DID return rows and none of them plotted.
  it('says why it drew nothing rather than leaving a blank panel', () => {
    renderWithProviders(
      <KpiHistoryRenderer visualization={viz({ valueColumn: 'gone' })} data={data} />
    )

    expect(screen.getByText(/needs a timestamp column and a numeric value column/i)).toBeInTheDocument()
  })
})
