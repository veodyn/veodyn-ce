import { describe, expect, it } from 'vitest'
import { parseGeometryCell } from './choropleth-geometry-cell'

const RING = [[0, 0], [1, 0], [1, 1], [0, 0]]

describe('parseGeometryCell', () => {
  describe('shapes it accepts', () => {
    it('reads a Polygon from a JSON string', () => {
      expect(parseGeometryCell(JSON.stringify({ type: 'Polygon', coordinates: [RING] }))).toEqual({
        type: 'Polygon',
        coordinates: [RING],
      })
    })

    it('reads a geometry that arrives already parsed', () => {
      expect(parseGeometryCell({ type: 'Point', coordinates: [1, 2] })).toEqual({
        type: 'Point',
        coordinates: [1, 2],
      })
    })

    it('takes the geometry out of a whole Feature', () => {
      const cell = { type: 'Feature', properties: { n: 1 }, geometry: { type: 'Polygon', coordinates: [RING] } }
      expect(parseGeometryCell(cell)).toEqual({ type: 'Polygon', coordinates: [RING] })
    })

    it('accepts each nesting depth at its own type', () => {
      expect(parseGeometryCell({ type: 'Point', coordinates: [1, 2] })).not.toBeNull()
      expect(parseGeometryCell({ type: 'MultiPoint', coordinates: [[1, 2]] })).not.toBeNull()
      expect(parseGeometryCell({ type: 'LineString', coordinates: [[1, 2], [3, 4]] })).not.toBeNull()
      expect(parseGeometryCell({ type: 'MultiLineString', coordinates: [[[1, 2], [3, 4]]] })).not.toBeNull()
      expect(parseGeometryCell({ type: 'Polygon', coordinates: [RING] })).not.toBeNull()
      expect(parseGeometryCell({ type: 'MultiPolygon', coordinates: [[RING]] })).not.toBeNull()
    })

    it('accepts a position carrying an elevation', () => {
      expect(parseGeometryCell({ type: 'Point', coordinates: [1, 2, 30] })).not.toBeNull()
    })

    it('accepts a GeometryCollection whose members are all valid', () => {
      const cell = {
        type: 'GeometryCollection',
        geometries: [{ type: 'Point', coordinates: [1, 2] }, { type: 'Polygon', coordinates: [RING] }],
      }
      expect(parseGeometryCell(cell)).toEqual(cell)
    })
  })

  describe('shapes it rejects', () => {
    it('rejects an empty, null, or unparsable cell', () => {
      expect(parseGeometryCell('')).toBeNull()
      expect(parseGeometryCell(null)).toBeNull()
      expect(parseGeometryCell(undefined)).toBeNull()
      expect(parseGeometryCell('{not json')).toBeNull()
      expect(parseGeometryCell(42)).toBeNull()
      expect(parseGeometryCell(JSON.stringify([1, 2, 3]))).toBeNull()
    })

    it('rejects a type outside the seven GeoJSON geometries', () => {
      expect(parseGeometryCell({ type: 'Bicycle', coordinates: [RING] })).toBeNull()
      expect(parseGeometryCell({ coordinates: [RING] })).toBeNull()
      expect(parseGeometryCell({ type: 'FeatureCollection', features: [] })).toBeNull()
    })

    // A recognized type with the wrong nesting is the shape that used to pass
    // the type check and reach MapLibre as invalid GeoJSON.
    it('rejects a recognized type nested too shallowly', () => {
      expect(parseGeometryCell({ type: 'Polygon', coordinates: [0, 0] })).toBeNull()
      expect(parseGeometryCell({ type: 'Polygon', coordinates: RING })).toBeNull()
      expect(parseGeometryCell({ type: 'MultiPolygon', coordinates: [RING] })).toBeNull()
      expect(parseGeometryCell({ type: 'LineString', coordinates: [0, 0] })).toBeNull()
    })

    it('rejects a recognized type nested too deeply', () => {
      expect(parseGeometryCell({ type: 'Point', coordinates: [[1, 2]] })).toBeNull()
      expect(parseGeometryCell({ type: 'Polygon', coordinates: [[RING]] })).toBeNull()
    })

    it('rejects missing or non-array coordinates', () => {
      expect(parseGeometryCell({ type: 'Polygon' })).toBeNull()
      expect(parseGeometryCell({ type: 'Polygon', coordinates: null })).toBeNull()
      expect(parseGeometryCell({ type: 'Polygon', coordinates: 'POLYGON((0 0))' })).toBeNull()
    })

    it('rejects an empty coordinates array at any level', () => {
      expect(parseGeometryCell({ type: 'Polygon', coordinates: [] })).toBeNull()
      expect(parseGeometryCell({ type: 'Polygon', coordinates: [[]] })).toBeNull()
      expect(parseGeometryCell({ type: 'MultiPolygon', coordinates: [[[]]] })).toBeNull()
      expect(parseGeometryCell({ type: 'Point', coordinates: [] })).toBeNull()
    })

    // A NaN reaching the bbox fit poisons the whole viewport, not just its own
    // region.
    it('rejects a position holding a value that is not a finite number', () => {
      expect(parseGeometryCell({ type: 'Point', coordinates: [Number.NaN, 2] })).toBeNull()
      expect(parseGeometryCell({ type: 'Point', coordinates: [1, Infinity] })).toBeNull()
      expect(parseGeometryCell({ type: 'Point', coordinates: ['1', '2'] })).toBeNull()
      expect(parseGeometryCell({ type: 'Point', coordinates: [1, null] })).toBeNull()
      expect(parseGeometryCell({ type: 'Polygon', coordinates: [[[0, 0], [1, Number.NaN], [1, 1], [0, 0]]] })).toBeNull()
    })

    it('rejects a position with fewer than two numbers', () => {
      expect(parseGeometryCell({ type: 'Point', coordinates: [1] })).toBeNull()
      expect(parseGeometryCell({ type: 'LineString', coordinates: [[1, 2], [3]] })).toBeNull()
    })

    // The shape that threw inside the bbox walk rather than being skipped.
    it('rejects a GeometryCollection with no geometries array', () => {
      expect(parseGeometryCell({ type: 'GeometryCollection' })).toBeNull()
      expect(parseGeometryCell({ type: 'GeometryCollection', geometries: null })).toBeNull()
      expect(parseGeometryCell({ type: 'GeometryCollection', geometries: [] })).toBeNull()
    })

    it('rejects a GeometryCollection holding one malformed member', () => {
      const cell = {
        type: 'GeometryCollection',
        geometries: [{ type: 'Point', coordinates: [1, 2] }, { type: 'Polygon', coordinates: [0, 0] }],
      }
      expect(parseGeometryCell(cell)).toBeNull()
    })

    it('rejects a Feature whose geometry is null or malformed', () => {
      expect(parseGeometryCell({ type: 'Feature', properties: {}, geometry: null })).toBeNull()
      expect(
        parseGeometryCell({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [0, 0] } })
      ).toBeNull()
    })

    it('never throws on any of them', () => {
      const nasty = [{ type: 'GeometryCollection' }, { type: 'Polygon', coordinates: [0, 0] }, [], '', 0]
      for (const cell of nasty) expect(() => parseGeometryCell(cell)).not.toThrow()
    })
  })
})
