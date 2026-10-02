// A map created without an editor drew an empty basemap unless the query
// happened to call its coordinates `lat` and `lon`. MAP's defaultOptions guess
// those two names and nothing corrected the guess, so an AI-authored widget
// over `latitude`/`longitude` looked exactly like a query that returned no
// rows. These are the cases that used to be blank.
import { describe, expect, it } from 'vitest'
import type { QueryResultData } from '@/lib/mock-data'
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
    // Both appear when a live feed is joined to a stops table. `lng` is what
    // GTFS-RT and the RIITS vehiclelocations resource return, and the vehicle
    // is the thing somebody wants pinned.
    expect(inferMapColumnMapping(result('lat', 'lng', 'lon'))).toEqual({
      latColName: 'lat',
      lonColName: 'lng',
    })
  })

  it('returns nothing rather than half a mapping', () => {
    // A latitude with no longitude still draws nothing, and now claims to be
    // configured. The chart and the heatmap follow the same rule.
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
    // `y` is last in the latitude list, but the analyst chose it and the result
    // has it. Only a name that resolves can be anyone's intent.
    const chosen = { latColName: 'y', lonColName: 'x' }
    expect(mapCoordinateOptions(chosen, result('y', 'x', 'lat', 'lon'))).toEqual(chosen)
  })

  it('leaves options alone when the result implies no coordinates at all', () => {
    // Better a map the editor can fix than one silently pointed at a column
    // that is not a coordinate.
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
