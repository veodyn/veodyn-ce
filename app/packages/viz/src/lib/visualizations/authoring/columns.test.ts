import { describe, expect, it } from 'vitest'
import { authoredColumnProblems } from './columns'
import { CORE_AUTHORING } from './core-authoring'

const COLUMNS = ['city', 'speed', 'lat', 'lon']

describe('authoredColumnProblems', () => {
  it('passes options that name existing columns', () => {
    const options = { latColName: 'lat', lonColName: 'lon', classify: 'city' }
    expect(authoredColumnProblems(CORE_AUTHORING.MAP, options, COLUMNS)).toEqual([])
  })

  it('reports a single column that is not in the result', () => {
    expect(authoredColumnProblems(CORE_AUTHORING.MAP, { latColName: 'latitude' }, COLUMNS)).toEqual([
      'latColName: no column named latitude',
    ])
  })

  it('lets unset, empty and unused values pass', () => {
    const options = { latColName: '', lonColName: '-- unused --', classify: undefined }
    expect(authoredColumnProblems(CORE_AUTHORING.MAP, options, COLUMNS)).toEqual([])
  })

  it('ignores non-string values and options with no column mark', () => {
    expect(authoredColumnProblems(CORE_AUTHORING.MAP, { latColName: 4, popup: { template: 'nope' } }, COLUMNS)).toEqual([])
  })

  it('checks a list of columns', () => {
    expect(authoredColumnProblems(CORE_AUTHORING.DETAILS, { columns: ['city', 'gone', 'speed', 'also'] }, COLUMNS)).toEqual([
      'columns: no column named gone',
      'columns: no column named also',
    ])
  })

  it('checks the keys of a column mapping', () => {
    const options = { columnMapping: { city: 'x', gone: 'y', speed: 'series' } }
    expect(authoredColumnProblems(CORE_AUTHORING.CHART, options, COLUMNS)).toEqual([
      'columnMapping: no column named gone',
    ])
  })

  it('lets a mapping entry parked as unused name a missing column', () => {
    const options = { columnMapping: { gone: '', other: '-- unused --', city: 'x' } }
    expect(authoredColumnProblems(CORE_AUTHORING.CHART, options, COLUMNS)).toEqual([])
  })

  it('checks table column configuration by name', () => {
    const options = { columns: [{ name: 'city', visible: true }, { name: 'gone', title: 'Gone' }, { title: 'no name' }] }
    expect(authoredColumnProblems(CORE_AUTHORING.TABLE, options, COLUMNS)).toEqual([
      'columns: no column named gone',
    ])
  })

  it('reads the geometry column only when the boundaries come from one', () => {
    const bundled = { boundarySource: 'map', keyColumn: 'city', geometryColumn: 'gone' }
    expect(authoredColumnProblems(CORE_AUTHORING.CHOROPLETH, bundled, COLUMNS)).toEqual([])
    const fromColumn = { boundarySource: 'column', keyColumn: 'city', geometryColumn: 'gone' }
    expect(authoredColumnProblems(CORE_AUTHORING.CHOROPLETH, fromColumn, COLUMNS)).toEqual([
      'geometryColumn: no column named gone',
    ])
  })

  it('does not check the map property a choropleth matches against', () => {
    expect(authoredColumnProblems(CORE_AUTHORING.CHOROPLETH, { targetField: 'iso_a2' }, COLUMNS)).toEqual([])
  })

  it('reports every problem across options', () => {
    const options = { stepColumn: 'a', valueColumn: 'b' }
    expect(authoredColumnProblems(CORE_AUTHORING.FUNNEL, options, COLUMNS)).toEqual([
      'stepColumn: no column named a',
      'valueColumn: no column named b',
    ])
  })
})
