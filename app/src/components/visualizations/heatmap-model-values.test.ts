import { describe, expect, it } from 'vitest'
import type { QueryResultData } from '@/lib/mock-data'
import type { RedashHeatmapOptions } from '@/services/redash/types'
import { buildHeatmapModel } from './heatmap-model'

// Which observations count. The model used to read every value as
// `Number(row[valueCol]) || 0`, so a null, an undefined, an empty string and a
// non-numeric string all became a real 0 observation: a cell holding 10 and a
// null averaged to 5, its min was 0, and those invented zeros moved the colour
// domain and the percentile clip points. Split into its own file rather than
// added to heatmap-model.test.ts, which is already near the project's
// file-size threshold.
//
// Nothing in here asserts a cell KEY, so the file says nothing about how a
// cell is identified; that is heatmap-model.test.ts's concern.

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

// One cell carrying a real 10 alongside a null. Every aggregation reads it
// differently, which is what makes it able to tell "skipped" from "counted as
// zero": as a zero the avg is 5 and the min is 0, skipped they are both 10.
const oneValidOneNull: QueryResultData = {
  columns,
  rows: [
    { weekday: 'Monday', period: 'Morning', count: 10 },
    { weekday: 'Monday', period: 'Morning', count: null },
  ],
}

// A grid with one fully valid cell and one cell whose only observation is
// unusable. The second cell has nothing to say, so it must not appear at all.
const oneValidCellOneEmptyCell: QueryResultData = {
  columns,
  rows: [
    { weekday: 'Monday', period: 'Morning', count: 10 },
    { weekday: 'Tuesday', period: 'Evening', count: null },
  ],
}

describe('buildHeatmapModel value validity', () => {
  describe('an invalid observation is skipped, not read as zero', () => {
    it('averages over the valid observations only', () => {
      const model = buildHeatmapModel({ columnMapping: mapping, aggregation: 'avg' }, oneValidOneNull)
      expect(Array.from(model?.cells.values() ?? [])).toEqual([10])
    })

    it('takes min and max over the valid observations only', () => {
      const min = buildHeatmapModel({ columnMapping: mapping, aggregation: 'min' }, oneValidOneNull)
      const max = buildHeatmapModel({ columnMapping: mapping, aggregation: 'max' }, oneValidOneNull)
      expect(Array.from(min?.cells.values() ?? [])).toEqual([10])
      expect(Array.from(max?.cells.values() ?? [])).toEqual([10])
    })

    it('skips undefined, an empty string, a blank string and a non-numeric string alike', () => {
      // Four separate shapes because they fail four different ways:
      // Number(undefined) is NaN, but Number(null), Number('') and Number(' ')
      // are all a finite 0, so a Number.isFinite check placed after the
      // coercion still lets three of the five through.
      const assorted: QueryResultData = {
        columns,
        rows: [
          { weekday: 'Monday', period: 'Morning', count: 10 },
          { weekday: 'Monday', period: 'Morning', count: undefined },
          { weekday: 'Monday', period: 'Morning', count: '' },
          { weekday: 'Monday', period: 'Morning', count: '   ' },
          { weekday: 'Monday', period: 'Morning', count: 'not-a-number' },
        ],
      }
      const model = buildHeatmapModel({ columnMapping: mapping, aggregation: 'avg' }, assorted)
      expect(Array.from(model?.cells.values() ?? [])).toEqual([10])
    })

    it('still reads a numeric string as the number it spells', () => {
      // The other half of the rule: a result set that hands numbers back as
      // strings is ordinary, and rejecting those would be a new bug of the
      // same family (data present, model says otherwise).
      const numericStrings: QueryResultData = {
        columns,
        rows: [
          { weekday: 'Monday', period: 'Morning', count: '10' },
          { weekday: 'Monday', period: 'Morning', count: '30' },
        ],
      }
      const model = buildHeatmapModel({ columnMapping: mapping }, numericStrings)
      expect(Array.from(model?.cells.values() ?? [])).toEqual([40])
    })
  })

  describe('a cell with nothing valid in it', () => {
    it('is omitted from the cell map rather than stored as a zero', () => {
      const model = buildHeatmapModel({ columnMapping: mapping }, oneValidCellOneEmptyCell)
      expect(model?.cells.size).toBe(1)
      expect(Array.from(model?.cells.values() ?? [])).toEqual([10])
    })

    it('leaves the colour domain to the cells that do have data', () => {
      // The invented zero was not only a wrong cell: it dragged rawMin (and
      // with it the whole colour ramp, and the percentile clip points) down to
      // 0, recolouring every other cell in the grid.
      const model = buildHeatmapModel({ columnMapping: mapping }, oneValidCellOneEmptyCell)
      expect(model?.rawMin).toBe(10)
      expect(model?.rawMax).toBe(10)
      expect(model?.min).toBe(10)
      expect(model?.max).toBe(10)
    })

    it('keeps its categories on the axes, so the row and column still exist and read as blank', () => {
      // The categories are real: the query returned those rows. What it did
      // not return is a usable value, and the renderer already draws an absent
      // cell blank rather than as a 0, which is the honest rendering.
      const model = buildHeatmapModel({ columnMapping: mapping }, oneValidCellOneEmptyCell)
      expect(model?.xCategories).toEqual(['Monday', 'Tuesday'])
      expect(model?.yCategories).toEqual(['Morning', 'Evening'])
    })
  })

  describe('a genuine zero is a real observation', () => {
    // These two pass against the old `|| 0` code as well, and are kept
    // deliberately: they are what stops the fix from being written as a
    // truthiness test (`if (!value)`), which would drop real zeros and trade
    // one silent lie for another.
    it('counts a zero in the average rather than discarding it', () => {
      const withZero: QueryResultData = {
        columns,
        rows: [
          { weekday: 'Monday', period: 'Morning', count: 0 },
          { weekday: 'Monday', period: 'Morning', count: 10 },
        ],
      }
      const model = buildHeatmapModel({ columnMapping: mapping, aggregation: 'avg' }, withZero)
      expect(Array.from(model?.cells.values() ?? [])).toEqual([5])
    })

    it('keeps a cell whose only observation is zero', () => {
      const onlyZero: QueryResultData = {
        columns,
        rows: [{ weekday: 'Monday', period: 'Morning', count: 0 }],
      }
      const model = buildHeatmapModel({ columnMapping: mapping }, onlyZero)
      expect(model?.cells.size).toBe(1)
      expect(Array.from(model?.cells.values() ?? [])).toEqual([0])
      expect(model?.rawMin).toBe(0)
    })
  })

  describe('count aggregation ignores the value column entirely', () => {
    // count answers "how many rows landed here", which does not consult the
    // value column at all, so an unusable value must not remove a row from the
    // tally or the cell from the map.
    it('counts every row in the cell, including the ones with no usable value', () => {
      const someInvalid: QueryResultData = {
        columns,
        rows: [
          { weekday: 'Monday', period: 'Morning', count: 10 },
          { weekday: 'Monday', period: 'Morning', count: null },
          { weekday: 'Monday', period: 'Morning', count: 'not-a-number' },
        ],
      }
      const model = buildHeatmapModel({ columnMapping: mapping, aggregation: 'count' }, someInvalid)
      expect(Array.from(model?.cells.values() ?? [])).toEqual([3])
    })

    it('keeps a cell whose every row has an unusable value', () => {
      const allInvalid: QueryResultData = {
        columns,
        rows: [
          { weekday: 'Monday', period: 'Morning', count: null },
          { weekday: 'Monday', period: 'Morning', count: null },
        ],
      }
      const model = buildHeatmapModel({ columnMapping: mapping, aggregation: 'count' }, allInvalid)
      expect(model?.cells.size).toBe(1)
      expect(Array.from(model?.cells.values() ?? [])).toEqual([2])
    })
  })
})
