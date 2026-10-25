import { describe, expect, it } from 'vitest'
import { optionChanges } from './viz-summary'

describe('optionChanges', () => {
  it('lists added, removed and changed keys and skips equal ones', () => {
    expect(
      optionChanges(
        { same: 1, gone: true, moved: 'a', nested: { a: 1 } },
        { same: 1, moved: 'b', fresh: { stacking: 'stack' }, nested: { a: 1 } }
      )
    ).toEqual([
      { key: 'gone', before: 'true', after: null },
      { key: 'moved', before: 'a', after: 'b' },
      { key: 'fresh', before: null, after: '{"stacking":"stack"}' },
    ])
  })

  it('treats every key as added when there is nothing before', () => {
    expect(optionChanges({}, { rowField: 'day' })).toEqual([{ key: 'rowField', before: null, after: 'day' }])
  })
})
