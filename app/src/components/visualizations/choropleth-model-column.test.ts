import { describe, expect, it } from 'vitest'
import type { FeatureCollection } from 'geojson'
import type { QueryResultData } from '@/lib/mock-data'
import { buildChoroplethModel } from './choropleth-model'

// Column mode never reads the geometry argument, so every case here passes an
// empty collection: a test that still passed with real world geometry in it
// would not be testing the row-built features.
const NO_GEOJSON: FeatureCollection = { type: 'FeatureCollection', features: [] }

const colors = {
  makeScale: (min: number, max: number) => (value: number) => (value === max ? 'HIGH' : value === min ? 'LOW' : 'MID'),
  noValue: 'NONE',
}

function square(x: number): string {
  return JSON.stringify({
    type: 'Polygon',
    coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]],
  })
}

const options = {
  boundarySource: 'column' as const,
  keyColumn: 'district',
  valueColumn: 'trips',
  geometryColumn: 'geom',
}

const columns = [
  { name: 'district', friendly_name: 'district', type: 'string' },
  { name: 'trips', friendly_name: 'trips', type: 'integer' },
  { name: 'geom', friendly_name: 'geom', type: 'string' },
]

function result(rows: Record<string, unknown>[]): QueryResultData {
  return { columns, rows } as QueryResultData
}

describe('buildChoroplethModel in geometry-column mode', () => {
  it('builds one feature per row and colors it from the value column', () => {
    const model = buildChoroplethModel(
      options,
      result([
        { district: 'North', trips: 100, geom: square(0) },
        { district: 'South', trips: 10, geom: square(2) },
      ]),
      NO_GEOJSON,
      colors
    )

    expect(model.featureCollection.features).toHaveLength(2)
    expect(model.matchedCount).toBe(2)
    expect(model.skippedCount).toBe(0)
    expect(model.min).toBe(10)
    expect(model.max).toBe(100)
    const byKey = Object.fromEntries(
      model.featureCollection.features.map((f) => [f.properties?.district, f.properties?.fillColor])
    )
    expect(byKey.North).toBe('HIGH')
    expect(byKey.South).toBe('LOW')
  })

  it('keeps each row geometry as its own feature geometry', () => {
    const model = buildChoroplethModel(
      options,
      result([{ district: 'North', trips: 1, geom: square(0) }]),
      NO_GEOJSON,
      colors
    )

    expect(model.featureCollection.features[0].geometry).toEqual({
      type: 'Polygon',
      coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
    })
  })

  it('accepts a MultiPolygon as readily as a Polygon', () => {
    const multi = JSON.stringify({
      type: 'MultiPolygon',
      coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]],
    })
    const model = buildChoroplethModel(
      options,
      result([{ district: 'North', trips: 5, geom: multi }]),
      NO_GEOJSON,
      colors
    )

    expect(model.featureCollection.features).toHaveLength(1)
    expect(model.featureCollection.features[0].geometry.type).toBe('MultiPolygon')
  })

  // The static_geojson runner emits a whole Feature per row; a spatial-join
  // query emits a bare geometry. Both are the same picture and both have to
  // draw.
  it('unwraps a full Feature cell to its geometry', () => {
    const feature = JSON.stringify({
      type: 'Feature',
      properties: { name: 'from the feature' },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    })
    const model = buildChoroplethModel(
      options,
      result([{ district: 'North', trips: 5, geom: feature }]),
      NO_GEOJSON,
      colors
    )

    expect(model.skippedCount).toBe(0)
    expect(model.featureCollection.features[0].geometry).toEqual({
      type: 'Polygon',
      coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]],
    })
  })

  // A JSON-typed column arrives already parsed rather than as text.
  it('accepts a geometry that is already an object', () => {
    const model = buildChoroplethModel(
      options,
      result([{ district: 'North', trips: 5, geom: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }]),
      NO_GEOJSON,
      colors
    )

    expect(model.skippedCount).toBe(0)
    expect(model.featureCollection.features).toHaveLength(1)
  })

  it('carries the joined value onto __value and the row key onto the key column', () => {
    const model = buildChoroplethModel(
      options,
      result([{ district: 'North', trips: 42, geom: square(0) }]),
      NO_GEOJSON,
      colors
    )

    expect(model.featureCollection.features[0].properties?.__value).toBe(42)
    expect(model.featureCollection.features[0].properties?.district).toBe('North')
  })

  it('draws a row with no usable value unshaded rather than dropping it', () => {
    const model = buildChoroplethModel(
      options,
      result([
        { district: 'North', trips: 100, geom: square(0) },
        { district: 'South', trips: null, geom: square(2) },
        { district: 'East', trips: '', geom: square(4) },
        { district: 'West', trips: 'n/a', geom: square(6) },
      ]),
      NO_GEOJSON,
      colors
    )

    expect(model.featureCollection.features).toHaveLength(4)
    expect(model.matchedCount).toBe(1)
    expect(model.skippedCount).toBe(0)
    const byKey = Object.fromEntries(
      model.featureCollection.features.map((f) => [f.properties?.district, f.properties])
    )
    expect(byKey.South?.fillColor).toBe('NONE')
    expect(byKey.South?.__value).toBe(null)
    expect(byKey.West?.fillColor).toBe('NONE')
  })

  it('computes the color domain over joined values only', () => {
    const model = buildChoroplethModel(
      options,
      result([
        { district: 'North', trips: 100, geom: square(0) },
        { district: 'South', trips: 10, geom: square(2) },
        // No geometry, so this row never becomes a region and must not widen
        // the domain the two drawn regions are shaded against.
        { district: 'Nowhere', trips: 1000000, geom: '' },
      ]),
      NO_GEOJSON,
      colors
    )

    expect(model.min).toBe(10)
    expect(model.max).toBe(100)
    expect(model.skippedCount).toBe(1)
  })

  it('ignores targetField, since each row is its own region', () => {
    const model = buildChoroplethModel(
      { ...options, targetField: 'iso_a2' },
      result([{ district: 'North', trips: 7, geom: square(0) }]),
      NO_GEOJSON,
      colors
    )

    expect(model.matchedCount).toBe(1)
    expect(model.featureCollection.features).toHaveLength(1)
  })

  describe('rows it cannot read', () => {
    it('skips and counts an empty, null, unparsable, or non-geometry cell without throwing', () => {
      const rows = [
        { district: 'A', trips: 1, geom: '' },
        { district: 'B', trips: 2, geom: null },
        { district: 'C', trips: 3, geom: '{not json' },
        { district: 'D', trips: 4, geom: JSON.stringify({ type: 'Bicycle', wheels: 2 }) },
        { district: 'E', trips: 5, geom: JSON.stringify({ coordinates: [[0, 0]] }) },
        { district: 'F', trips: 6, geom: JSON.stringify([1, 2, 3]) },
        { district: 'G', trips: 7, geom: square(0) },
      ]

      expect(() => buildChoroplethModel(options, result(rows), NO_GEOJSON, colors)).not.toThrow()
      const model = buildChoroplethModel(options, result(rows), NO_GEOJSON, colors)
      expect(model.featureCollection.features).toHaveLength(1)
      expect(model.skippedCount).toBe(6)
      expect(model.matchedCount).toBe(1)
    })

    // A Feature whose geometry is null is valid GeoJSON and draws nothing.
    it('skips a Feature carrying a null geometry', () => {
      const model = buildChoroplethModel(
        options,
        result([{ district: 'A', trips: 1, geom: JSON.stringify({ type: 'Feature', properties: {}, geometry: null }) }]),
        NO_GEOJSON,
        colors
      )

      expect(model.featureCollection.features).toHaveLength(0)
      expect(model.skippedCount).toBe(1)
    })

    it('yields the empty state, not a crash, when every row is unreadable', () => {
      const model = buildChoroplethModel(
        options,
        result([
          { district: 'A', trips: 1, geom: 'nope' },
          { district: 'B', trips: 2, geom: '' },
        ]),
        NO_GEOJSON,
        colors
      )

      expect(model.featureCollection).toEqual({ type: 'FeatureCollection', features: [] })
      expect(model.matchedCount).toBe(0)
      expect(model.skippedCount).toBe(2)
      expect(model.min).toBe(0)
      expect(model.max).toBe(0)
    })

    it('degrades to empty when geometryColumn is unset', () => {
      const model = buildChoroplethModel(
        { boundarySource: 'column', keyColumn: 'district', valueColumn: 'trips' },
        result([{ district: 'A', trips: 1, geom: square(0) }]),
        NO_GEOJSON,
        colors
      )

      expect(model.featureCollection.features).toHaveLength(0)
      expect(model.matchedCount).toBe(0)
    })

    it('degrades to empty when geometryColumn names a column the result lacks', () => {
      const model = buildChoroplethModel(
        { ...options, geometryColumn: 'ghost' },
        result([{ district: 'A', trips: 1, geom: square(0) }]),
        NO_GEOJSON,
        colors
      )

      expect(model.featureCollection.features).toHaveLength(0)
      expect(model.skippedCount).toBe(1)
    })
  })
})
