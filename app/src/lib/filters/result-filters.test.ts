/**
 * Redash's result-filter convention: a query author opts a column into a filter
 * by naming it `route_id::filter` (or `__filter`, or the multi variants). The
 * suffix is not part of the data, so it has to come off before the column is
 * displayed anywhere, and the column drives a filter control above the results.
 *
 * See upstream Redash client/app/services/query-result.js: filterTypes,
 * getColumnNameWithoutType, and the getFilters loop.
 */
import { describe, expect, it } from 'vitest'
import type { QueryResultData } from '@/lib/mock-data'
import {
  applyResultFilters,
  columnDisplayName,
  detectResultFilters,
  displayColumns,
} from './result-filters'

function data(columnNames: string[], rows: Record<string, unknown>[]): QueryResultData {
  return {
    columns: columnNames.map((name) => ({ name, friendly_name: name, type: 'string' })),
    rows,
  }
}

describe('columnDisplayName', () => {
  it('strips a filter suffix', () => {
    expect(columnDisplayName('route_id::filter')).toBe('route_id')
    expect(columnDisplayName('route_id::multi-filter')).toBe('route_id')
    expect(columnDisplayName('route_id::multiFilter')).toBe('route_id')
  })

  it('accepts the double-underscore separator too', () => {
    expect(columnDisplayName('route_id__filter')).toBe('route_id')
  })

  // A column that merely contains the separator is not a filter, and renaming
  // it would misreport the data.
  it('leaves an ordinary column alone', () => {
    expect(columnDisplayName('route_id')).toBe('route_id')
    expect(columnDisplayName('a::b')).toBe('a::b')
    expect(columnDisplayName('some__column')).toBe('some__column')
  })
})

describe('displayColumns', () => {
  // The suffix is an instruction to the UI, not part of the data, so a table
  // that printed it would show a header reading "route_id::filter".
  it('cleans the label while leaving the key that indexes the rows', () => {
    const [column] = displayColumns(data(['route_id::filter'], []).columns)

    expect(column.friendly_name).toBe('route_id')
    expect(column.name).toBe('route_id::filter')
  })

  // A runner that supplied its own friendly name knows better than a suffix
  // strip does.
  it('keeps a friendly name the runner already gave', () => {
    const [column] = displayColumns([
      { name: 'route_id::filter', friendly_name: 'Route', type: 'string' },
    ])

    expect(column.friendly_name).toBe('Route')
  })

  it('leaves ordinary columns untouched', () => {
    expect(displayColumns(data(['trips'], []).columns)[0].friendly_name).toBe('trips')
  })
})

describe('detectResultFilters', () => {
  it('finds a filter column and offers its distinct values', () => {
    const filters = detectResultFilters(
      data(
        ['route_id::filter', 'trips'],
        [
          { 'route_id::filter': '12', trips: 4 },
          { 'route_id::filter': '40', trips: 9 },
          { 'route_id::filter': '12', trips: 2 },
        ]
      )
    )

    expect(filters).toHaveLength(1)
    expect(filters[0]).toMatchObject({
      name: 'route_id::filter',
      friendlyName: 'route_id',
      multiple: false,
    })
    expect(filters[0].values).toEqual(['12', '40'])
  })

  it('marks the multi variants as taking several values', () => {
    expect(detectResultFilters(data(['x::multi-filter'], []))[0].multiple).toBe(true)
    expect(detectResultFilters(data(['x::multiFilter'], []))[0].multiple).toBe(true)
    expect(detectResultFilters(data(['x::filter'], []))[0].multiple).toBe(false)
  })

  it('finds nothing in a result with no filter columns', () => {
    expect(detectResultFilters(data(['route_id', 'trips'], []))).toEqual([])
  })
})

describe('applyResultFilters', () => {
  const RESULT = data(
    ['route_id::filter', 'trips'],
    [
      { 'route_id::filter': '12', trips: 4 },
      { 'route_id::filter': '40', trips: 9 },
    ]
  )

  it('keeps only the rows matching the selection', () => {
    const filtered = applyResultFilters(RESULT, { 'route_id::filter': ['12'] })

    expect(filtered.rows).toEqual([{ 'route_id::filter': '12', trips: 4 }])
  })

  it('keeps everything when nothing is selected', () => {
    expect(applyResultFilters(RESULT, {}).rows).toHaveLength(2)
    expect(applyResultFilters(RESULT, { 'route_id::filter': [] }).rows).toHaveLength(2)
  })

  it('keeps a row matching any of several selected values', () => {
    const filtered = applyResultFilters(RESULT, { 'route_id::filter': ['12', '40'] })

    expect(filtered.rows).toHaveLength(2)
  })

  // The columns come back untouched: filtering is about rows, and rebuilding
  // the column list here would drop whatever the caller had already resolved.
  it('leaves the columns as they were', () => {
    expect(applyResultFilters(RESULT, { 'route_id::filter': ['12'] }).columns).toEqual(
      RESULT.columns
    )
  })
})
