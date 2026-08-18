import { describe, expect, it } from 'vitest'
import type { QueryResultData } from '@/lib/mock-data'
import type { RedashHeatmapOptions } from '@/services/redash/types'
import { cellKey } from './heatmap-cell-key'
import { buildHeatmapModel } from './heatmap-model'
import { sortYCategories } from './heatmap-model-sort'

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

// All three orders differ, so each mode is discriminated:
//
//   Steady  10 10 10 10   total 40   peak 10
//   Spike   30  1  1  1   total 33   peak 30
//   Middle  12 12 12  1   total 37   peak 12
//
//   'none'  Steady, Spike, Middle   (the order they first appear below)
//   'total' Steady, Middle, Spike   (40, 37, 33)
//   'peak'  Spike, Middle, Steady   (30, 12, 10)
//
// Spike separates the two ranked modes: lowest total, highest single cell, so it
// lands last under 'total' and first under 'peak'.
//
// The rows are emitted column-major so first-appearance order of the TEAM values
// (what 'none' preserves) is not the same walk as the row literals.
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
    // Every heatmap stored before this option existed has no sortRows key.
    expect(order(undefined)).toEqual(['Steady', 'Spike', 'Middle'])
  })

  it('ranks rows by the sum of their cells, descending, with sortRows total', () => {
    expect(order('total')).toEqual(['Steady', 'Middle', 'Spike'])
  })

  it('ranks rows by their single largest cell, descending, with sortRows peak', () => {
    expect(order('peak')).toEqual(['Spike', 'Middle', 'Steady'])
  })

  it('produces three genuinely different orders, so each mode above is discriminated', () => {
    // Guards the fixture, not the implementation: an edit making 'total' and
    // 'peak' agree would leave the two tests above passing vacuously.
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
    // Catches a secondary sort key, not sort stability (a language guarantee
    // since ES2019): the team names are in reverse alphabetical order, so an
    // implementation breaking ties on the label fails this.
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
    // A y category exists because a row named it, but that row writes no cell if
    // its value was unusable, so a row can be on the axis with nothing in it.
    // Ranking such a row 0 would put it ABOVE every real row on a negative grid.
    const cells = new Map([
      [cellKey('Q1', 'Real'), -5],
      [cellKey('Q2', 'Real'), -9],
    ])
    expect(sortYCategories(['Empty', 'Real'], ['Q1', 'Q2'], cells, 'total')).toEqual(['Real', 'Empty'])
    expect(sortYCategories(['Empty', 'Real'], ['Q1', 'Q2'], cells, 'peak')).toEqual(['Real', 'Empty'])
  })

  it('treats an (x, y) combination with no rows as absent, not as a zero', () => {
    // Only negative values show the difference: Sparse is present in two of four
    // quarters at -5, Dense in all four at -1. Reading a gap as zero makes
    // Sparse's peak 0 and ranks it FIRST; as absent its peak is -5 and it is last.
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
