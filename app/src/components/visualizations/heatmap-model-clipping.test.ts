import { describe, expect, it } from 'vitest'
import type { QueryResultData } from '@/lib/mock-data'
import type { RedashHeatmapOptions } from '@/services/redash/types'
import { cellKey } from './heatmap-cell-key'
import { buildHeatmapModel } from './heatmap-model'

// Split out of heatmap-model.test.ts (Task 4's outlier clipping) once the
// combined file crossed the project's file-size threshold. Everything else
// about buildHeatmapModel (aggregation, category order, column resolution,
// shouldShowValues, ...) stays in heatmap-model.test.ts; this file is just the
// clipOutliers seam.

const columns: QueryResultData['columns'] = [
  { name: 'weekday', friendly_name: 'weekday', type: 'string' },
  { name: 'period', friendly_name: 'period', type: 'string' },
  { name: 'count', friendly_name: 'count', type: 'integer' },
]

const mapping: RedashHeatmapOptions['columnMapping'] = {
  weekday: 'x',
  period: 'y',
  count: 'value',
}

// Three rows on the SAME (x, y) cell with three DIFFERENT values, mirroring
// the shared fixture in heatmap-model.test.ts: this only needs a model with
// more than one row, not the aggregation distinctions that fixture exists for.
const multiRowData: QueryResultData = {
  columns,
  rows: [
    { weekday: 'Monday', period: 'Morning', count: 10 },
    { weekday: 'Monday', period: 'Morning', count: 30 },
    { weekday: 'Monday', period: 'Morning', count: 20 },
  ],
}

describe('buildHeatmapModel clipping', () => {
  describe('clipping left off', () => {
    it('leaves min/max equal to rawMin/rawMax and clipped false when clipOutliers is not set', () => {
      const model = buildHeatmapModel({ columnMapping: mapping }, multiRowData)
      expect(model?.min).toBe(model?.rawMin)
      expect(model?.max).toBe(model?.rawMax)
      expect(model?.clipped).toBe(false)
    })
  })

  describe('outlier clipping', () => {
    const outlierColumns: QueryResultData['columns'] = [
      { name: 'row', friendly_name: 'row', type: 'string' },
      { name: 'col', friendly_name: 'col', type: 'string' },
      { name: 'value', friendly_name: 'value', type: 'integer' },
    ]
    const outlierMapping: RedashHeatmapOptions['columnMapping'] = { row: 'x', col: 'y', value: 'value' }

    // 100 ordinary cells with values 1..100 on 100 distinct (x, y) pairs, plus
    // ONE cell at 1,000,000: an outlier far enough outside the ordinary
    // cluster that it genuinely distorts the raw domain. A fixture without
    // this kind of outlier would make the clipped domain equal the raw
    // domain, which would pass against an implementation that clips nothing
    // at all (the exact vacuous-test trap this task warns against).
    const ordinaryRows = Array.from({ length: 100 }, (_, i) => ({
      row: `Row ${i}`,
      col: 'Only',
      value: i + 1,
    }))
    const outlierData: QueryResultData = {
      columns: outlierColumns,
      rows: [...ordinaryRows, { row: 'Outlier', col: 'Only', value: 1_000_000 }],
    }

    it('leaves the raw domain untouched: rawMin/rawMax still see the true outlier', () => {
      const model = buildHeatmapModel({ columnMapping: outlierMapping, clipOutliers: true }, outlierData)
      expect(model?.rawMin).toBe(1)
      expect(model?.rawMax).toBe(1_000_000)
    })

    it('narrows min/max to the 2nd/98th percentile when clipOutliers is set, so the clipped domain DIFFERS from the raw one', () => {
      const model = buildHeatmapModel({ columnMapping: outlierMapping, clipOutliers: true }, outlierData)
      // 101 sorted values (1..100, then 1,000,000). Linear-interpolation
      // percentile at p=2 and p=98 over that set lands exactly on the value
      // at rank index 2 and index 98 respectively (both integral ranks),
      // which is 3 and 99: nowhere near the raw 1 and 1,000,000. See the
      // 'outlier clipping with a fractional percentile rank' describe block
      // below: this fixture's integral ranks cannot tell linear interpolation
      // apart from nearest-rank, that one can.
      expect(model?.min).toBe(3)
      expect(model?.max).toBe(99)
      expect(model?.min).not.toBe(model?.rawMin)
      expect(model?.max).not.toBe(model?.rawMax)
      expect(model?.clipped).toBe(true)
    })

    it('keeps the outlier cell in the cell map at its true value: clipping narrows the colour domain, it never removes or rewrites data', () => {
      const model = buildHeatmapModel({ columnMapping: outlierMapping, clipOutliers: true }, outlierData)
      expect(model?.cells.get(cellKey('Outlier', 'Only'))).toBe(1_000_000)
      expect(model?.cells.size).toBe(101)
    })
  })

  describe('outlier clipping with a fractional percentile rank', () => {
    // The 101-value fixture above happens to put both p=2 and p=98 on an
    // EXACT INTEGER rank ((p/100)*(length-1) = 2.0 and 98.0), so the
    // `lower === upper` short-circuit in percentile() returns before the
    // weighted lerp ever runs. A nearest-rank implementation would produce
    // the identical 3 and 99 there, so that fixture cannot tell linear
    // interpolation apart from the nearest-rank method this task deliberately
    // rejected. This fixture's 10 values give (length-1) = 9, so
    // 0.02*9 = 0.18 and 0.98*9 = 8.82: both fractional, both forcing the
    // interpolation branch to execute and produce a value nearest-rank
    // rounding would not.
    const outlierColumns: QueryResultData['columns'] = [
      { name: 'row', friendly_name: 'row', type: 'string' },
      { name: 'col', friendly_name: 'col', type: 'string' },
      { name: 'value', friendly_name: 'value', type: 'integer' },
    ]
    const outlierMapping: RedashHeatmapOptions['columnMapping'] = { row: 'x', col: 'y', value: 'value' }
    const fractionalRankRows = Array.from({ length: 10 }, (_, i) => ({
      row: `Row ${i}`,
      col: 'Only',
      value: (i + 1) * 10, // 10, 20, ..., 100
    }))
    const fractionalRankData: QueryResultData = { columns: outlierColumns, rows: fractionalRankRows }

    it('interpolates between the two bracketing values at a fractional rank, rather than snapping to either one', () => {
      const model = buildHeatmapModel({ columnMapping: outlierMapping, clipOutliers: true }, fractionalRankData)
      // rank(2) = 0.18 -> between sorted[0]=10 and sorted[1]=20, weight 0.18:
      // 10 + (20 - 10) * 0.18 = 11.8.
      // rank(98) = 8.82 -> between sorted[8]=90 and sorted[9]=100, weight 0.82:
      // 90 + (100 - 90) * 0.82 = 98.2.
      // Nearest-rank rounding would instead return 10 (round(0.18) = 0) and
      // 100 (round(8.82) = 9): neither matches these values, which is the
      // point of this fixture.
      expect(model?.min).toBeCloseTo(11.8, 5)
      expect(model?.max).toBeCloseTo(98.2, 5)
      expect(model?.clipped).toBe(true)
    })
  })
})
