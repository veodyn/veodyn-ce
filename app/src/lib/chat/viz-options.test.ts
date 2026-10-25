import { describe, expect, it } from 'vitest'
import { sanitizedVizOptions } from './viz-options'

describe('sanitizedVizOptions', () => {
  it('keeps what the type declares and drops the rest', () => {
    expect(sanitizedVizOptions('CHART', { globalSeriesType: 'bar', bogus: 1, columnMapping: { a: 'x' } })).toEqual({
      globalSeriesType: 'bar',
      columnMapping: { a: 'x' },
    })
  })

  it('drops a value that fails an enum', () => {
    expect(sanitizedVizOptions('CHART', { globalSeriesType: 'radar' })).toEqual({})
  })

  it('answers nothing for a type with no declaration and for no options', () => {
    expect(sanitizedVizOptions('PLUGIN_X', { a: 1 })).toEqual({})
    expect(sanitizedVizOptions('CHART', undefined)).toEqual({})
  })
})
