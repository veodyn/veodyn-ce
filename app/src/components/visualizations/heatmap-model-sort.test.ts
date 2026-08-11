import { describe, expect, it } from 'vitest'
import type { QueryResultData } from '@/lib/mock-data'
import type { RedashHeatmapOptions } from '@/services/redash/types'
import { cellKey } from './heatmap-cell-key'
import { buildHeatmapModel } from './heatmap-model'
import { sortYCategories } from './heatmap-model-sort'

// Task 6's row sort, in its own file rather than appended to
// heatmap-model.test.ts, the same seam heatmap-model-clipping.test.ts already
// split along: it needs a fixture of its own and nothing else in the model
// tests shares it.

const columns: QueryResultData['columns'] = [
  { name: 'quarter', friendly_name: 'Quarter', type: 'string' },
  { name: 'team', friendly_name: 'Team', type: 'string' },
  { name: 'deals', friendly_name: 'Deals', type: 'integer' },
]

const mapping: RedashHeatmapOptions['columnMapping'] = {
  quarter: 'x',
  team: 'y',
  deals: 'value',
}

// THE fixture decision this whole file turns on: a sort tested against data
// that is already in the target order proves nothing, and a sort with two
// ranked modes tested against data where those modes agree proves only one of
// them. All three orders here are different from each other:
//
//   Steady  10 10 10 10   total 40   peak 10
//   Spike   30  1  1  1   total 33   peak 30
//   Middle  12 12 12  1   total 37   peak 12
//
//   'none'  Steady, Spike, Middle   (the order they first appear below)
//   'total' Steady, Middle, Spike   (40, 37, 33)
//   'peak'  Spike, Middle, Steady   (30, 12, 10)
//
// Spike is the row that separates the two ranked modes: it has the LOWEST
// total of the three and the HIGHEST single cell, so it lands last under
// 'total' and first under 'peak'. An implementation that ranked by total when
// asked for peak, or the reverse, cannot pass both. `orders differ` below
// asserts that property of the fixture directly, so a future edit that
// flattens it fails loudly instead of quietly hollowing these tests out.
//
// The rows are emitted column-major so first-appearance order of the TEAM
// values (which is what 'none' preserves) is Steady, Spike, Middle, and is not
// accidentally the same walk as the row literals being grouped by team.
const rows: QueryResultData['rows'] = []
for (const [quarter, values] of [
  ['Q1', { Steady: 10, Spike: 30, Middle: 12 }],
  ['Q2', { Steady: 10, Spike: 1, Middle: 12 }],
  ['Q3', { Steady: 10, Spike: 1, Middle: 12 }],
  ['Q4', { Steady: 10, Spike: 1, Middle: 1 }],
] as const) {
  for (const [team, deals] of Object.entries(values)) {
    rows.push({ quarter, team, deals })
  }
}

const data: QueryResultData = { columns, rows }

const order = (sortRows?: RedashHeatmapOptions['sortRows']) =>
  buildHeatmapModel({ columnMapping: mapping, sortRows }, data)?.yCategories

describe('buildHeatmapModel sortRows', () => {
  it('keeps the order the rows first appear in when sortRows is none', () => {
    expect(order('none')).toEqual(['Steady', 'Spike', 'Middle'])
  })

  it('defaults to that same order when sortRows is absent, so no saved heatmap changes shape', () => {
    // The migration constraint, asserted rather than assumed: every heatmap
    // stored before this option existed has no sortRows key at all.
    expect(order(undefined)).toEqual(['Steady', 'Spike', 'Middle'])
  })

  it('ranks rows by the sum of their cells, descending, with sortRows total', () => {
    expect(order('total')).toEqual(['Steady', 'Middle', 'Spike'])
  })

  it('ranks rows by their single largest cell, descending, with sortRows peak', () => {
    expect(order('peak')).toEqual(['Spike', 'Middle', 'Steady'])
  })

  it('produces three genuinely different orders, so each mode above is discriminated', () => {
    // Guards the fixture, not the implementation. Without this, an edit that
    // made 'total' and 'peak' agree would leave the two tests above passing
    // while one of the two implementations went unverified, which is exactly
    // the failure mode this phase has already shipped once.
    const none = order('none')
    const total = order('total')
    const peak = order('peak')
    expect(total).not.toEqual(none)
    expect(peak).not.toEqual(none)
    expect(peak).not.toEqual(total)
  })

  it('leaves the columns and every cell value untouched: sortRows reorders rows and nothing else', () => {
    const unsorted = buildHeatmapModel({ columnMapping: mapping }, data)
    const sorted = buildHeatmapModel({ columnMapping: mapping, sortRows: 'peak' }, data)

    expect(sorted?.xCategories).toEqual(unsorted?.xCategories)
    expect(sorted?.xCategories).toEqual(['Q1', 'Q2', 'Q3', 'Q4'])
    expect(Object.fromEntries(sorted?.cells ?? [])).toEqual(Object.fromEntries(unsorted?.cells ?? []))
    expect(sorted?.min).toBe(unsorted?.min)
    expect(sorted?.max).toBe(unsorted?.max)
  })

  it('keeps tied rows in the order they first appeared, rather than sorting them by name', () => {
    // What this does NOT catch, said plainly: Array.prototype.sort's own
    // stability is a language guarantee (ES2019 onward), so no implementation
    // built on it can lose a tie's order by accident, and a comparator
    // returning a constant nonzero value for every pair happens to leave a
    // short array untouched anyway (measured: it does not fail this test).
    //
    // What it DOES catch is the plausible one: a secondary sort key. The team
    // names here are deliberately in reverse alphabetical order, so an
    // implementation that broke ties on the label (an easy thing to add, and
    // wrong, since it silently reorders rows a query put in a meaningful
    // order) produces First, Second instead.
    const tied: QueryResultData = {
      columns,
      rows: [
        { quarter: 'Q1', team: 'Zulu', deals: 7 },
        { quarter: 'Q1', team: 'Mike', deals: 7 },
        { quarter: 'Q1', team: 'Alfa', deals: 7 },
        { quarter: 'Q2', team: 'Zulu', deals: 7 },
        { quarter: 'Q2', team: 'Mike', deals: 7 },
        { quarter: 'Q2', team: 'Alfa', deals: 7 },
      ],
    }
    const none = buildHeatmapModel({ columnMapping: mapping }, tied)?.yCategories
    expect(none).toEqual(['Zulu', 'Mike', 'Alfa'])
    expect(buildHeatmapModel({ columnMapping: mapping, sortRows: 'total' }, tied)?.yCategories).toEqual(none)
    expect(buildHeatmapModel({ columnMapping: mapping, sortRows: 'peak' }, tied)?.yCategories).toEqual(none)
  })

  it('sinks a row with no cells at all to the bottom, even against a grid of negative values', () => {
    // Reached through sortYCategories directly here, and reachable out of
    // buildHeatmapModel too since the value-validity fix: a y category exists
    // because some row named it, but that row writes no cell if its value was
    // unusable, so a row can now be on the axis with nothing in it. Asserted
    // rather than left undefined because "an empty row ranks 0" would put it
    // ABOVE every real row on a grid of negatives, which is the opposite of
    // what an empty row means.
    const cells = new Map([
      [cellKey('Q1', 'Real'), -5],
      [cellKey('Q2', 'Real'), -9],
    ])
    expect(sortYCategories(['Empty', 'Real'], ['Q1', 'Q2'], cells, 'total')).toEqual(['Real', 'Empty'])
    expect(sortYCategories(['Empty', 'Real'], ['Q1', 'Q2'], cells, 'peak')).toEqual(['Real', 'Empty'])
  })

  it('treats an (x, y) combination with no rows as absent, not as a zero', () => {
    // Only negative values can show the difference, which is why this fixture
    // is the one place in the heatmap tests that has any. "Sparse" is present
    // in two of the four quarters at -5; "Dense" is present in all four at -1.
    // Reading a gap as a zero would make Sparse's peak 0 and rank it FIRST;
    // reading it as absent makes its peak -5 and ranks it last.
    const negative: QueryResultData = {
      columns,
      rows: [
        { quarter: 'Q1', team: 'Sparse', deals: -5 },
        { quarter: 'Q1', team: 'Dense', deals: -1 },
        { quarter: 'Q2', team: 'Sparse', deals: -5 },
        { quarter: 'Q2', team: 'Dense', deals: -1 },
        { quarter: 'Q3', team: 'Dense', deals: -1 },
        { quarter: 'Q4', team: 'Dense', deals: -1 },
      ],
    }
    // The gaps are real: Sparse has no cell at all in Q3 or Q4.
    const model = buildHeatmapModel({ columnMapping: mapping, sortRows: 'peak' }, negative)
    expect(model?.cells.has(cellKey('Q3', 'Sparse'))).toBe(false)
    expect(model?.cells.has(cellKey('Q4', 'Sparse'))).toBe(false)

    expect(model?.yCategories).toEqual(['Dense', 'Sparse'])
  })
})
