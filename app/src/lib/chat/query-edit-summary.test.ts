import { describe, expect, it } from 'vitest'
import { fieldChanges, lineDiff } from './query-edit-summary'
import type { ChatQuerySnapshot } from './tool-results-query'

const SNAPSHOT: ChatQuerySnapshot = {
  id: 5,
  name: 'Trips',
  description: null,
  sql: 'select {{ limit }}',
  dataSourceId: 2,
  parameters: [{ name: 'limit', type: 'number', value: 10 }],
  tags: [],
  schedule: null,
  isDraft: false,
  updatedAt: 'u',
}

function parameterRows(parameters: Record<string, unknown>[]) {
  return fieldChanges(SNAPSHOT, { parameters: parameters as never }).filter((row) => row.field.startsWith('parameters'))
}

describe('fieldChanges for parameters', () => {
  it('shows a changed default as before and after', () => {
    const rows = parameterRows([{ name: 'limit', type: 'number', value: 10000 }])
    expect(rows).toEqual([{ field: 'parameters:limit:value', label: 'Parameter limit: default', before: '10', after: '10000' }])
  })

  it('shows a changed type', () => {
    const rows = parameterRows([{ name: 'limit', type: 'text', value: 10 }])
    expect(rows).toEqual([{ field: 'parameters:limit:type', label: 'Parameter limit: type', before: 'number', after: 'text' }])
  })

  it('shows changed enum options and quoting', () => {
    const before = { ...SNAPSHOT, parameters: [{ name: 'day', type: 'enum', enumOptions: 'a\nb', multi: true, quote: 'none' }] }
    const rows = fieldChanges(before, {
      parameters: [{ name: 'day', type: 'enum', enumOptions: 'a\nb\nc', multi: true, quote: 'single' }],
    }).map((row) => row.label)
    expect(rows).toEqual(['Parameter day: options', 'Parameter day: quoting'])
  })

  it('names added and removed parameters', () => {
    const rows = parameterRows([{ name: 'since', type: 'date' }])
    expect(rows).toEqual([
      { field: 'parameters:limit', label: 'Parameter limit', before: 'number', after: 'Removed' },
      { field: 'parameters:since', label: 'Parameter since', before: 'None', after: 'Added, date' },
    ])
  })

  it('shows nothing for an unchanged parameter', () => {
    expect(parameterRows([{ name: 'limit', type: 'number', value: 10 }])).toEqual([])
  })
})

describe('lineDiff', () => {
  it('diffs small inputs line by line', () => {
    expect(lineDiff('a\nb', 'a\nc')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'c' },
    ])
  })

  it('falls back to a whole-block before and after past the size bound', () => {
    const lines = Array.from({ length: 2000 }, (_, i) => `line ${i}`)
    const before = lines.join('\n')
    const after = [...lines.slice(0, 1999), 'changed'].join('\n')
    const started = performance.now()
    const diff = lineDiff(before, after)
    expect(performance.now() - started).toBeLessThan(500)
    expect(diff).toHaveLength(4000)
    expect(diff.slice(0, 2000).every((line) => line.kind === 'removed')).toBe(true)
    expect(diff.slice(2000).every((line) => line.kind === 'added')).toBe(true)
  })

  it('keeps the line diff just inside the bound', () => {
    const lines = Array.from({ length: 400 }, (_, i) => `line ${i}`)
    const diff = lineDiff(lines.join('\n'), [...lines.slice(0, 399), 'changed'].join('\n'))
    expect(diff.filter((line) => line.kind === 'same')).toHaveLength(399)
  })
})
