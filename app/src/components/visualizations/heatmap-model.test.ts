import { describe, expect, it } from 'vitest'
import type { QueryResultData } from '@/lib/mock-data'
import type { RedashHeatmapOptions } from '@/services/redash/types'
import { cellKey } from './heatmap-cell-key'
import { buildHeatmapModel, HEATMAP_VALUE_DENSITY_THRESHOLD, shouldShowValues } from './heatmap-model'

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

// Three rows on the SAME (x, y) cell with three DIFFERENT values. A fixture
// with one row per cell cannot tell sum, avg, min and max apart, since they
// would all agree on the single value.
const multiRowData: QueryResultData = {
  columns,
  rows: [
    { weekday: 'Monday', period: 'Morning', count: 10 },
    { weekday: 'Monday', period: 'Morning', count: 30 },
    { weekday: 'Monday', period: 'Morning', count: 20 },
  ],
}

describe('buildHeatmapModel', () => {
  describe('aggregations', () => {
    it('sums duplicate cells by default', () => {
      const model = buildHeatmapModel({ columnMapping: mapping }, multiRowData)
      expect(model?.cells.get(cellKey('Monday', 'Morning'))).toBe(60)
    })

    it('averages duplicate cells with aggregation avg', () => {
      const model = buildHeatmapModel({ columnMapping: mapping, aggregation: 'avg' }, multiRowData)
      expect(model?.cells.get(cellKey('Monday', 'Morning'))).toBe(20)
    })

    it('takes the minimum of duplicate cells with aggregation min', () => {
      const model = buildHeatmapModel({ columnMapping: mapping, aggregation: 'min' }, multiRowData)
      expect(model?.cells.get(cellKey('Monday', 'Morning'))).toBe(10)
    })

    it('takes the maximum of duplicate cells with aggregation max', () => {
      const model = buildHeatmapModel({ columnMapping: mapping, aggregation: 'max' }, multiRowData)
      expect(model?.cells.get(cellKey('Monday', 'Morning'))).toBe(30)
    })

    it('counts rows per cell with aggregation count, ignoring the value column entirely', () => {
      const model = buildHeatmapModel({ columnMapping: mapping, aggregation: 'count' }, multiRowData)
      expect(model?.cells.get(cellKey('Monday', 'Morning'))).toBe(3)
    })

  })

  describe('duplicate cells collapsing', () => {
    it('collapses multiple rows for the same (x, y) pair into a single cell entry', () => {
      const model = buildHeatmapModel({ columnMapping: mapping }, multiRowData)
      expect(model?.cells.size).toBe(1)
    })

    it('keeps distinct (x, y) pairs as separate cells', () => {
      const twoCells: QueryResultData = {
        columns,
        rows: [
          { weekday: 'Monday', period: 'Morning', count: 10 },
          { weekday: 'Tuesday', period: 'Evening', count: 34 },
        ],
      }
      const model = buildHeatmapModel({ columnMapping: mapping }, twoCells)
      expect(model?.cells.size).toBe(2)
      expect(model?.cells.get(cellKey('Monday', 'Morning'))).toBe(10)
      expect(model?.cells.get(cellKey('Tuesday', 'Evening'))).toBe(34)
    })

    it('keeps two category pairs whose text runs together into the same string as separate cells', () => {
      // ('New York', 'West') and ('New', 'York West') are different cells that
      // a plain-space join flattens into one 'New York West' key: the two rows
      // aggregated into a single 30, and BOTH rendered cells drew it.
      //
      // The requirement asserted here is that distinct category pairs stay
      // distinct cells. Which separator (or encoding) achieves that is the
      // fix, not the requirement, so nothing below names one: the assertions
      // read the map's SIZE and its VALUES, never a key.
      const collidingPairs: QueryResultData = {
        columns,
        rows: [
          { weekday: 'New York', period: 'West', count: 10 },
          { weekday: 'New', period: 'York West', count: 20 },
        ],
      }
      const model = buildHeatmapModel({ columnMapping: mapping }, collidingPairs)
      expect(model?.cells.size).toBe(2)
      expect(Array.from(model?.cells.values() ?? []).sort((a, b) => a - b)).toEqual([10, 20])
      expect(Array.from(model?.cells.values() ?? [])).not.toContain(30)
    })
  })

  describe('category order', () => {
    it('preserves first-seen row order for categories, not sorted order', () => {
      // Rows arrive in an order that is neither alphabetical nor reversed, so
      // a switch from Set insertion order to a sorted array would be caught
      // regardless of which sort direction it introduced.
      const outOfAlphaOrder: QueryResultData = {
        columns,
        rows: [
          { weekday: 'Wednesday', period: 'Evening', count: 1 },
          { weekday: 'Monday', period: 'Morning', count: 2 },
          { weekday: 'Tuesday', period: 'Afternoon', count: 3 },
        ],
      }
      const model = buildHeatmapModel({ columnMapping: mapping }, outOfAlphaOrder)
      expect(model?.xCategories).toEqual(['Wednesday', 'Monday', 'Tuesday'])
      expect(model?.yCategories).toEqual(['Evening', 'Morning', 'Afternoon'])
    })
  })

  describe('missing columns', () => {
    it('returns null when there is no resolvable y column', () => {
      const oneColumn: QueryResultData = {
        columns: [{ name: 'weekday', friendly_name: 'weekday', type: 'string' }],
        rows: [{ weekday: 'Monday' }],
      }
      const model = buildHeatmapModel({}, oneColumn)
      expect(model).toBeNull()
    })

    it('returns null when there is no resolvable value column and aggregation is not count', () => {
      const noValueColumn: QueryResultData = {
        columns: [
          { name: 'weekday', friendly_name: 'weekday', type: 'string' },
          { name: 'period', friendly_name: 'period', type: 'string' },
        ],
        rows: [{ weekday: 'Monday', period: 'Morning' }],
      }
      const model = buildHeatmapModel({}, noValueColumn)
      expect(model).toBeNull()
    })

    it('does not require a value column when aggregation is count', () => {
      const noValueColumn: QueryResultData = {
        columns: [
          { name: 'weekday', friendly_name: 'weekday', type: 'string' },
          { name: 'period', friendly_name: 'period', type: 'string' },
        ],
        rows: [{ weekday: 'Monday', period: 'Morning' }],
      }
      const model = buildHeatmapModel({ aggregation: 'count' }, noValueColumn)
      expect(model).not.toBeNull()
      expect(model?.cells.get(cellKey('Monday', 'Morning'))).toBe(1)
    })
  })

  describe('empty result', () => {
    it('returns an empty model with a zeroed domain instead of Infinity, when there are no rows', () => {
      const model = buildHeatmapModel({ columnMapping: mapping }, { columns, rows: [] })
      expect(model).not.toBeNull()
      expect(model?.xCategories).toEqual([])
      expect(model?.yCategories).toEqual([])
      expect(model?.cells.size).toBe(0)
      expect(model?.min).toBe(0)
      expect(model?.max).toBe(0)
      expect(model?.rawMin).toBe(0)
      expect(model?.rawMax).toBe(0)
      expect(model?.cellCount).toBe(0)
    })
  })

  describe('single-cell result', () => {
    it('sets min equal to max when there is exactly one cell', () => {
      const singleCell: QueryResultData = {
        columns,
        rows: [{ weekday: 'Monday', period: 'Morning', count: 42 }],
      }
      const model = buildHeatmapModel({ columnMapping: mapping }, singleCell)
      expect(model?.min).toBe(42)
      expect(model?.max).toBe(42)
      expect(model?.rawMin).toBe(42)
      expect(model?.rawMax).toBe(42)
      expect(model?.cellCount).toBe(1)
    })
  })

  // Value validity (null, empty, non-numeric, and the genuine zero that has to
  // keep counting) has its own file, heatmap-model-values.test.ts. Column
  // resolution against a stale mapping has heatmap-model-columns.test.ts.
  describe('column fallback resolution', () => {
    it('falls back to the first two columns for x and y, and the first remaining numeric column for value, when no mapping is given', () => {
      const model = buildHeatmapModel({}, multiRowData)
      expect(model?.cells.get(cellKey('Monday', 'Morning'))).toBe(60)
    })
  })

  // Outlier clipping (clipOutliers) has its own file,
  // heatmap-model-clipping.test.ts, split out once the combined file crossed
  // the project's file-size threshold.
})

describe('shouldShowValues', () => {
  // Pins the constant to the literal 150 from the brief, not just to itself:
  // a test that only exercised the threshold via its own name would keep
  // passing if the constant's value silently drifted.
  it('sets the density threshold to exactly 150 cells', () => {
    expect(HEATMAP_VALUE_DENSITY_THRESHOLD).toBe(150)
  })

  describe('the auto boundary, checked at the exact cell counts the brief names', () => {
    // 10 and 1000 would pass whichever side of `<` or `<=` the code landed
    // on. Only the two grid sizes either side of the line prove which side
    // the implementation actually chose.
    it('shows values at exactly 150 cells', () => {
      expect(shouldShowValues('auto', 150)).toBe(true)
    })

    it('hides values at exactly 151 cells', () => {
      expect(shouldShowValues('auto', 151)).toBe(false)
    })

    it('treats the default (no showValues set) the same as auto', () => {
      expect(shouldShowValues(undefined, 150)).toBe(true)
      expect(shouldShowValues(undefined, 151)).toBe(false)
    })
  })

  describe('explicit overrides', () => {
    it('always shows values on a grid far past the threshold', () => {
      expect(shouldShowValues('always', 10_000)).toBe(true)
    })

    it('never shows values on a single-cell grid', () => {
      expect(shouldShowValues('never', 1)).toBe(false)
    })
  })
})
