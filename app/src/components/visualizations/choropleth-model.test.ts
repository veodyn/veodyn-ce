import { describe, expect, it } from 'vitest'
import type { FeatureCollection } from 'geojson'
import type { QueryResultData } from '@/lib/mock-data'
import { buildChoroplethModel } from './choropleth-model'

const geojson: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { iso_a2: 'US' }, geometry: { type: 'Polygon', coordinates: [] } },
    { type: 'Feature', properties: { iso_a2: 'CA' }, geometry: { type: 'Polygon', coordinates: [] } },
    { type: 'Feature', properties: { iso_a2: 'MX' }, geometry: { type: 'Polygon', coordinates: [] } },
  ],
}

const data: QueryResultData = {
  columns: [
    { name: 'code', friendly_name: 'code', type: 'string' },
    { name: 'v', friendly_name: 'v', type: 'integer' },
  ],
  rows: [
    { code: 'US', v: 100 },
    { code: 'CA', v: 0 },
  ],
}

const options = { keyColumn: 'code', valueColumn: 'v', targetField: 'iso_a2' }
// Deterministic scale: low endpoint at min, high endpoint at max.
const colors = {
  makeScale: (min: number, max: number) => (value: number) => (value === max ? 'HIGH' : value === min ? 'LOW' : 'MID'),
  noValue: 'NONE',
}

describe('buildChoroplethModel', () => {
  it('joins values onto features by targetField and colors matched regions', () => {
    const model = buildChoroplethModel(options, data, geojson, colors)
    expect(model.min).toBe(0)
    expect(model.max).toBe(100)
    expect(model.matchedCount).toBe(2)
    const byKey = Object.fromEntries(
      model.featureCollection.features.map((f) => [f.properties?.iso_a2, f.properties?.fillColor])
    )
    expect(byKey.US).toBe('HIGH')
    expect(byKey.CA).toBe('LOW')
    expect(byKey.MX).toBe('NONE')
  })

  it('carries the joined raw value onto __value, and null for unmatched regions', () => {
    const model = buildChoroplethModel(options, data, geojson, colors)
    const byKey = Object.fromEntries(
      model.featureCollection.features.map((f) => [f.properties?.iso_a2, f.properties?.__value])
    )
    expect(byKey.US).toBe(100)
    expect(byKey.CA).toBe(0)
    expect(byKey.MX).toBe(null)
  })

  it('reports zero matches when nothing joins', () => {
    const model = buildChoroplethModel(
      { keyColumn: 'code', valueColumn: 'v', targetField: 'name' },
      data,
      geojson,
      colors
    )
    expect(model.matchedCount).toBe(0)
  })

  it('degrades cleanly (does not throw) when keyColumn is missing', () => {
    expect(() =>
      buildChoroplethModel({ valueColumn: 'v', targetField: 'iso_a2' }, data, geojson, colors)
    ).not.toThrow()
    const model = buildChoroplethModel({ valueColumn: 'v', targetField: 'iso_a2' }, data, geojson, colors)
    expect(model.matchedCount).toBe(0)
    expect(model.min).toBe(0)
    expect(model.max).toBe(0)
    for (const feature of model.featureCollection.features) {
      expect(feature.properties?.fillColor).toBe('NONE')
      expect(feature.properties?.__value).toBe(null)
    }
  })

  it('degrades cleanly (does not throw) when valueColumn is missing', () => {
    const model = buildChoroplethModel({ keyColumn: 'code', targetField: 'iso_a2' }, data, geojson, colors)
    expect(model.matchedCount).toBe(0)
    expect(model.min).toBe(0)
    expect(model.max).toBe(0)
    for (const feature of model.featureCollection.features) {
      expect(feature.properties?.fillColor).toBe('NONE')
    }
  })

  it('degrades cleanly (does not throw) on empty row data', () => {
    const empty: QueryResultData = { columns: data.columns, rows: [] }
    expect(() => buildChoroplethModel(options, empty, geojson, colors)).not.toThrow()
    const model = buildChoroplethModel(options, empty, geojson, colors)
    expect(model.matchedCount).toBe(0)
    expect(model.min).toBe(0)
    expect(model.max).toBe(0)
    expect(model.featureCollection.features).toHaveLength(3)
    for (const feature of model.featureCollection.features) {
      expect(feature.properties?.fillColor).toBe('NONE')
    }
  })

  it('degrades cleanly (does not throw) on empty geometry with no features', () => {
    const emptyGeo: FeatureCollection = { type: 'FeatureCollection', features: [] }
    expect(() => buildChoroplethModel(options, data, emptyGeo, colors)).not.toThrow()
    const model = buildChoroplethModel(options, data, emptyGeo, colors)
    expect(model.featureCollection.features).toHaveLength(0)
    expect(model.matchedCount).toBe(0)
    // The domain is derived from values that join to a feature. With no
    // features at all, nothing joins, so the domain collapses to 0/0 rather
    // than reflecting values that never rendered anywhere.
    expect(model.min).toBe(0)
    expect(model.max).toBe(0)
  })

  it('does not let an unmatched outlier widen the matched domain', () => {
    // ZZ has no matching feature in the geojson (only US/CA/MX exist), so its
    // huge value must not stretch the scale and compress US/CA's real spread.
    const withOutlier: QueryResultData = {
      columns: data.columns,
      rows: [...data.rows, { code: 'ZZ', v: 1000000 }],
    }
    const model = buildChoroplethModel(options, withOutlier, geojson, colors)
    expect(model.min).toBe(0)
    expect(model.max).toBe(100)
    expect(model.matchedCount).toBe(2)
    const byKey = Object.fromEntries(
      model.featureCollection.features.map((f) => [f.properties?.iso_a2, f.properties?.fillColor])
    )
    expect(byKey.US).toBe('HIGH')
    expect(byKey.CA).toBe('LOW')
  })

  it('rejects null and empty-string values instead of coercing them to 0-matched', () => {
    const withNoData: QueryResultData = {
      columns: data.columns,
      rows: [
        { code: 'US', v: 100 },
        { code: 'CA', v: 0 },
        { code: 'MX', v: null },
      ],
    }
    const model = buildChoroplethModel(options, withNoData, geojson, colors)
    expect(model.matchedCount).toBe(2)
    const byKey = Object.fromEntries(
      model.featureCollection.features.map((f) => [f.properties?.iso_a2, f.properties])
    )
    expect(byKey.MX?.__value).toBe(null)
    expect(byKey.MX?.fillColor).toBe('NONE')
    // Genuine 0 is a real value and must still be accepted.
    expect(byKey.CA?.__value).toBe(0)
    expect(byKey.CA?.fillColor).toBe('LOW')

    const withEmptyString: QueryResultData = {
      columns: data.columns,
      rows: [
        { code: 'US', v: 100 },
        { code: 'MX', v: '' },
      ],
    }
    const model2 = buildChoroplethModel(options, withEmptyString, geojson, colors)
    expect(model2.matchedCount).toBe(1)
    const byKey2 = Object.fromEntries(
      model2.featureCollection.features.map((f) => [f.properties?.iso_a2, f.properties?.__value])
    )
    expect(byKey2.MX).toBe(null)
  })

  it('never throws on malformed geometry and reports zero matches', () => {
    const malformed = { type: 'FeatureCollection' } as unknown as FeatureCollection
    expect(() => buildChoroplethModel(options, data, malformed, colors)).not.toThrow()
    const model = buildChoroplethModel(options, data, malformed, colors)
    expect(model.matchedCount).toBe(0)
    expect(model.min).toBe(0)
    expect(model.max).toBe(0)
    expect(model.featureCollection).toEqual({ type: 'FeatureCollection', features: [] })
  })

  it('never throws when geojson itself is missing', () => {
    const model = buildChoroplethModel(options, data, undefined as unknown as FeatureCollection, colors)
    expect(model.matchedCount).toBe(0)
    expect(model.featureCollection.features).toHaveLength(0)
  })

  // The saved-options guarantee for the geometry-column mode: absent means the
  // bundled map, so a choropleth authored before that mode existed keeps the
  // shape it had.
  it('joins by targetField when boundarySource is absent, even with a geometryColumn set', () => {
    const model = buildChoroplethModel({ ...options, geometryColumn: 'code' }, data, geojson, colors)
    expect(model.matchedCount).toBe(2)
    expect(model.skippedCount).toBe(0)
    const byKey = Object.fromEntries(
      model.featureCollection.features.map((f) => [f.properties?.iso_a2, f.properties?.fillColor])
    )
    expect(byKey.US).toBe('HIGH')
    expect(byKey.CA).toBe('LOW')
    expect(byKey.MX).toBe('NONE')
  })

  // The tooltip labels a region from __key in both modes, so map mode has to
  // write one too, taken from the property the join matched on.
  it('carries the matched map property onto __key', () => {
    const model = buildChoroplethModel(options, data, geojson, colors)
    const byKey = Object.fromEntries(
      model.featureCollection.features.map((f) => [f.properties?.iso_a2, f.properties?.__key])
    )
    expect(byKey.US).toBe('US')
    expect(byKey.MX).toBe('MX')
  })

  it('leaves __key null when no map property is selected', () => {
    const model = buildChoroplethModel({ keyColumn: 'code', valueColumn: 'v' }, data, geojson, colors)
    for (const feature of model.featureCollection.features) {
      expect(feature.properties?.__key).toBe(null)
    }
  })

  it('joins by targetField when boundarySource is the explicit "map"', () => {
    const model = buildChoroplethModel({ ...options, boundarySource: 'map' }, data, geojson, colors)
    expect(model.matchedCount).toBe(2)
    expect(model.featureCollection.features.map((f) => f.properties?.iso_a2)).toEqual(['US', 'CA', 'MX'])
  })
})
