// Which columns a heatmap names for itself, and when it refuses to guess.
//
// resolveColumns already falls back positionally, so every case here is about
// what gets WRITTEN into saved options: an AI-authored heatmap has no editor to
// pass through, and a mapping is the only place its axes are recorded.
import { describe, expect, it } from 'vitest'
import type { QueryResultData } from '@/lib/mock-data'
import { inferHeatmapColumnMapping } from './heatmap-column-mapping'

function result(columns: [string, string][]): QueryResultData {
  return {
    columns: columns.map(([name, type]) => ({ name, friendly_name: name, type })),
    rows: [],
  }
}

describe('inferHeatmapColumnMapping', () => {
  it('colours by the first measure when the query returns more than one', () => {
    // `SELECT hour, station, avg_aqi, max_aqi`. avg before max in the SELECT is
    // the author saying which one the picture is about, and it is what the
    // positional fallback already draws.
    const mapping = inferHeatmapColumnMapping(
      result([
        ['hour', 'datetime'],
        ['station', 'string'],
        ['avg_aqi', 'float'],
        ['max_aqi', 'float'],
      ])
    )

    expect(mapping).toEqual({ hour: 'x', station: 'y', avg_aqi: 'value' })
  })

  it('takes the aggregate as the value even when a grouping column is numeric', () => {
    // `SELECT hour, name, avg(bikes)`. Reaching for the FIRST numeric column
    // would map `hour` as the value and colour the grid by time of day, which
    // is the axis, not the measure. The axes stay in SELECT order, so the 24
    // hours run across x rather than the stations.
    const mapping = inferHeatmapColumnMapping(
      result([
        ['hour', 'integer'],
        ['name', 'string'],
        ['avg_bikes', 'float'],
      ])
    )

    expect(mapping).toEqual({ hour: 'x', name: 'y', avg_bikes: 'value' })
  })

  it('keeps the two grouping columns in the order the query returned them', () => {
    const mapping = inferHeatmapColumnMapping(
      result([
        ['station', 'string'],
        ['day', 'date'],
        ['trips', 'integer'],
      ])
    )

    expect(mapping).toEqual({ station: 'x', day: 'y', trips: 'value' })
  })

  it('ignores the columns past the first two axes rather than mapping them', () => {
    // A wider result is not a heatmap, but it is also not a reason to write a
    // mapping nobody asked for: only x, y and value have a role to play.
    const mapping = inferHeatmapColumnMapping(
      result([
        ['station', 'string'],
        ['day', 'date'],
        ['line', 'string'],
        ['trips', 'integer'],
      ])
    )

    expect(mapping).toEqual({ station: 'x', day: 'y', trips: 'value' })
  })

  it('writes nothing when there is no measure to colour by', () => {
    const mapping = inferHeatmapColumnMapping(
      result([
        ['station', 'string'],
        ['day', 'date'],
      ])
    )

    expect(mapping).toEqual({})
  })

  it('writes nothing rather than half a mapping when an axis is missing', () => {
    // Half a mapping is worse than none: it replaces the positional fallback
    // without standing in for it, and the model's required-columns guard then
    // draws nothing at all.
    const mapping = inferHeatmapColumnMapping(
      result([
        ['station', 'string'],
        ['trips', 'integer'],
      ])
    )

    expect(mapping).toEqual({})
  })

  it('writes nothing for an empty result', () => {
    expect(inferHeatmapColumnMapping(result([]))).toEqual({})
  })
})
