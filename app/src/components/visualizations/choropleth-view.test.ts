import { describe, expect, it } from 'vitest'
import type { FeatureCollection, Geometry } from 'geojson'
import { WORLD_VIEW, viewForFeatureCollection } from './choropleth-view'

function collect(...geometries: Geometry[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: geometries.map((geometry) => ({ type: 'Feature', properties: {}, geometry })),
  }
}

const polygon = (x: number, y: number): Geometry => ({
  type: 'Polygon',
  coordinates: [[[x, y], [x + 2, y], [x + 2, y + 2], [x, y + 2], [x, y]]],
})

describe('viewForFeatureCollection', () => {
  it('falls back to the whole world when there is nothing to frame', () => {
    expect(viewForFeatureCollection(collect())).toEqual(WORLD_VIEW)
  })

  it('centres on the middle of a single region', () => {
    const view = viewForFeatureCollection(collect(polygon(10, 40)))
    expect(view.longitude).toBe(11)
    expect(view.latitude).toBe(41)
  })

  it('centres on the middle of the spread across several regions', () => {
    const view = viewForFeatureCollection(collect(polygon(0, 0), polygon(10, 20)))
    expect(view.longitude).toBe(6)
    expect(view.latitude).toBe(11)
  })

  // A city's tracts span a fraction of a degree; the bundled world map's fixed
  // zoom 1 would leave them a speck. A wider spread has to open wider.
  it('zooms in further on a tighter spread', () => {
    const tight = viewForFeatureCollection(
      collect({ type: 'Polygon', coordinates: [[[0, 0], [0.05, 0], [0.05, 0.05], [0, 0]]] })
    )
    const wide = viewForFeatureCollection(collect(polygon(0, 0), polygon(100, 40)))
    expect(tight.zoom).toBeGreaterThan(wide.zoom)
    expect(tight.zoom).toBeLessThanOrEqual(15)
    expect(wide.zoom).toBeGreaterThanOrEqual(1)
  })

  it('walks the nesting of a MultiPolygon rather than reading the first ring', () => {
    const multi: Geometry = {
      type: 'MultiPolygon',
      coordinates: [
        [[[0, 0], [1, 0], [1, 1], [0, 0]]],
        [[[20, 30], [21, 30], [21, 31], [20, 30]]],
      ],
    }
    const view = viewForFeatureCollection(collect(multi))
    expect(view.longitude).toBe(10.5)
    expect(view.latitude).toBe(15.5)
  })

  it('reads a bare Point geometry', () => {
    const view = viewForFeatureCollection(collect({ type: 'Point', coordinates: [5, 7] }))
    expect(view.longitude).toBe(5)
    expect(view.latitude).toBe(7)
  })

  it('ignores coordinates that are not finite numbers', () => {
    const broken: Geometry = {
      type: 'Polygon',
      coordinates: [[[0, 0], [2, 2], [Number.NaN, 100], [0, 0]]],
    }
    const view = viewForFeatureCollection(collect(broken))
    expect(view.longitude).toBe(1)
    expect(view.latitude).toBe(1)
  })

  it('falls back to the whole world when no coordinate is usable', () => {
    const broken: Geometry = { type: 'Polygon', coordinates: [[]] }
    expect(viewForFeatureCollection(collect(broken))).toEqual(WORLD_VIEW)
  })

  it('never throws on a GeometryCollection', () => {
    const nested: Geometry = {
      type: 'GeometryCollection',
      geometries: [{ type: 'Point', coordinates: [4, 6] }],
    }
    expect(() => viewForFeatureCollection(collect(nested))).not.toThrow()
    expect(viewForFeatureCollection(collect(nested)).longitude).toBe(4)
  })

  // Map-mode geometry comes from the bundled asset without passing through
  // parseGeometryCell, so the walk cannot assume the shape is well formed.
  it('never throws on a GeometryCollection with no geometries', () => {
    const broken = { type: 'GeometryCollection' } as unknown as Geometry
    expect(() => viewForFeatureCollection(collect(broken))).not.toThrow()
    expect(viewForFeatureCollection(collect(broken))).toEqual(WORLD_VIEW)
  })
})
