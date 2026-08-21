import { describe, expect, it } from 'vitest'
import { CORE_PUBLIC_OPTIONS, NAMED_COLUMNS } from './core-options'
import { sanitizeOptions } from './option-schema'

// An option the schema does not name is stripped from a public or embedded
// report, so the reader gets a visualization missing the half of its
// configuration that decides what it draws.
describe('CHOROPLETH public options', () => {
  it('keeps a geometry-column choropleth intact through the public round-trip', () => {
    const saved = {
      boundarySource: 'column',
      keyColumn: 'district',
      valueColumn: 'trips',
      geometryColumn: 'boundary',
    }

    expect(sanitizeOptions(CORE_PUBLIC_OPTIONS.CHOROPLETH, saved)).toEqual(saved)
  })

  it('keeps a bundled-map choropleth intact through the public round-trip', () => {
    const saved = {
      mapType: 'world-countries',
      keyColumn: 'country',
      targetField: 'iso_a2',
      valueColumn: 'revenue',
    }

    expect(sanitizeOptions(CORE_PUBLIC_OPTIONS.CHOROPLETH, saved)).toEqual(saved)
  })

  it('drops a boundarySource that is not a string rather than coercing it', () => {
    expect(sanitizeOptions(CORE_PUBLIC_OPTIONS.CHOROPLETH, { boundarySource: 3, keyColumn: 'district' })).toEqual({
      keyColumn: 'district',
    })
  })

  // geometryColumn holds a column name, so it belongs with the other named
  // columns: a name the query stopped returning has to be reported, not drawn
  // as an empty map.
  it('validates geometryColumn as a named column', () => {
    expect(NAMED_COLUMNS.CHOROPLETH.map((entry) => entry.key)).toContain('geometryColumn')
  })
})
