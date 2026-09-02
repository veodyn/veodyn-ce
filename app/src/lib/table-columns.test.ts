import { describe, expect, it } from 'vitest'
import type { QueryResultColumn } from '@/lib/mock-data'
import { effectiveColumnConfig, reorderColumns } from './table-columns'

const sourceColumns: QueryResultColumn[] = [
  { name: 'a', friendly_name: 'a', type: 'string' },
  { name: 'b', friendly_name: 'b', type: 'string' },
  { name: 'c', friendly_name: 'c', type: 'string' },
]

describe('effectiveColumnConfig', () => {
  it('falls back to source order for columns with no saved config', () => {
    expect(effectiveColumnConfig(sourceColumns, undefined).map((c) => c.name)).toEqual(['a', 'b', 'c'])
  })

  it('sorts by the saved order', () => {
    const config = [
      { name: 'a', order: 2 },
      { name: 'b', order: 0 },
      { name: 'c', order: 1 },
    ]

    expect(effectiveColumnConfig(sourceColumns, config).map((c) => c.name)).toEqual(['b', 'c', 'a'])
  })
})

describe('reorderColumns', () => {
  it('moves a column to the position of the one it was dropped on', () => {
    const next = reorderColumns(sourceColumns, undefined, 'c', 'a')

    expect(next.map((c) => c.name)).toEqual(['c', 'a', 'b'])
    expect(next.map((c) => c.order)).toEqual([0, 1, 2])
  })

  it('moves a column rightwards past its drop target', () => {
    expect(reorderColumns(sourceColumns, undefined, 'a', 'c').map((c) => c.name)).toEqual(['b', 'c', 'a'])
  })

  it('keeps hidden columns and their settings', () => {
    const config = [
      { name: 'a', order: 0, visible: true, title: 'Alpha' },
      { name: 'b', order: 1, visible: false },
      { name: 'c', order: 2, visible: true, displayAs: 'number' as const },
    ]

    const next = reorderColumns(sourceColumns, config, 'c', 'a')

    expect(next).toEqual([
      { name: 'c', order: 0, visible: true, displayAs: 'number' },
      { name: 'a', order: 1, visible: true, title: 'Alpha' },
      { name: 'b', order: 2, visible: false },
    ])
  })

  it('returns the config unchanged when a column is dropped on itself', () => {
    expect(reorderColumns(sourceColumns, undefined, 'b', 'b').map((c) => c.name)).toEqual(['a', 'b', 'c'])
  })

  it('ignores a column that is not in the result', () => {
    expect(reorderColumns(sourceColumns, undefined, 'gone', 'a').map((c) => c.name)).toEqual(['a', 'b', 'c'])
  })
})
