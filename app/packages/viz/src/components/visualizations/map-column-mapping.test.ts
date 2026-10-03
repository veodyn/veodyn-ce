import { describe, expect, it } from 'vitest'
import type { QueryResultData } from '../../types/viz-data'
import { inferMapColumnMapping, mapCoordinateOptions } from './map-column-mapping'

const DEFAULTS = { latColName: 'lat', lonColName: 'lon', popup: { enabled: true } }

function result(...names: string[]): QueryResultData {
  return { columns: names.map((name) => ({ name, type: 'float', friendly_name: name })), rows: [] }
}

describe('inferMapColumnMapping', () => {
  it.each([
    ['lat/lon', ['lat', 'lon'], { latColName: 'lat', lonColName: 'lon' }],
    ['a geocoder', ['latitude', 'longitude'], { latColName: 'latitude', lonColName: 'longitude' }],
    ['a GTFS-RT feed', ['lat', 'lng'], { latColName: 'lat', lonColName: 'lng' }],
    ['a GTFS stops table', ['stop_lat', 'stop_lon'], { latColName: 'stop_lat', lonColName: 'stop_lon' }],
  ])('reads the coordinates of %s', (_label, columns, expected) => {
    expect(inferMapColumnMapping(result(...columns))).toEqual(expected)
  })

  it('takes the short spelling when a result carries both', () => {
    expect(inferMapColumnMapping(result('lat', 'latitude', 'lon'))).toEqual({
      latColName: 'lat',
      lonColName: 'lon',
    })
  })

  it('prefers lng over lon, which is the vehicle position in a joined result', () => {
    expect(inferMapColumnMapping(result('lat', 'lng', 'lon'))).toEqual({
      latColName: 'lat',
      lonColName: 'lng',
    })
  })

  it('returns nothing rather than half a mapping', () => {
    expect(inferMapColumnMapping(result('latitude', 'station', 'count'))).toEqual({})
    expect(inferMapColumnMapping(result('station', 'count'))).toEqual({})
    expect(inferMapColumnMapping(result())).toEqual({})
  })
})

describe('mapCoordinateOptions', () => {
  it('repoints the guess at what the result actually returns', () => {
    expect(mapCoordinateOptions(DEFAULTS, result('latitude', 'longitude'))).toEqual({
      latColName: 'latitude',
      lonColName: 'longitude',
      popup: { enabled: true },
    })
  })

  it("keeps a name the query returns, even when it is not the candidate it would pick", () => {
    const chosen = { latColName: 'y', lonColName: 'x' }
    expect(mapCoordinateOptions(chosen, result('y', 'x', 'lat', 'lon'))).toEqual(chosen)
  })

  it('leaves options alone when the result implies no coordinates at all', () => {
    expect(mapCoordinateOptions(DEFAULTS, result('station', 'count'))).toEqual(DEFAULTS)
  })

  it('repoints a half-resolving pair, since half a map draws nothing', () => {
    const stale = { latColName: 'lat', lonColName: 'gone' }
    expect(mapCoordinateOptions(stale, result('lat', 'lng'))).toEqual({
      latColName: 'lat',
      lonColName: 'lng',
    })
  })

  it('does not mutate the options it is handed', () => {
    const given = { ...DEFAULTS }
    mapCoordinateOptions(given, result('latitude', 'longitude'))
    expect(given).toEqual(DEFAULTS)
  })
})
