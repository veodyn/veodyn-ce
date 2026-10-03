import type { Geometry } from 'geojson'

// How deep a type's `coordinates` nest above a position (RFC 7946): a Point is
// one position, a LineString a list of them, a Polygon a list of rings, a
// MultiPolygon a list of polygons. GeometryCollection has no coordinates and is
// checked through its members instead.
const COORDINATE_DEPTH: Record<string, number> = {
  Point: 0,
  MultiPoint: 1,
  LineString: 1,
  MultiLineString: 2,
  Polygon: 2,
  MultiPolygon: 3,
}

// A position is two or more finite numbers: longitude, latitude, optional
// elevation. A NaN here does not stay in its own region, it poisons the bbox
// the whole viewport is fitted to.
function isPosition(value: unknown): boolean {
  if (!Array.isArray(value) || value.length < 2) return false
  return value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
}

// Exact depth, not "at least": a Polygon whose coordinates are one ring deep is
// as unusable to MapLibre as one that is a bare position.
function isNested(value: unknown, depth: number): boolean {
  if (depth === 0) return isPosition(value)
  if (!Array.isArray(value) || value.length === 0) return false
  return value.every((entry) => isNested(entry, depth - 1))
}

function isGeometry(value: unknown): value is Geometry {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false
  const { type, coordinates, geometries } = value as {
    type?: unknown
    coordinates?: unknown
    geometries?: unknown
  }
  if (typeof type !== 'string') return false
  if (type === 'GeometryCollection') {
    return Array.isArray(geometries) && geometries.length > 0 && geometries.every(isGeometry)
  }
  const depth = COORDINATE_DEPTH[type]
  return depth !== undefined && isNested(coordinates, depth)
}

/**
 * Reads one result cell as a region outline, returning `null` for anything it
 * cannot use so the caller can count the row rather than fail the whole map.
 *
 * Accepts a stringified or already-parsed value, a bare geometry, or a whole
 * Feature (whose geometry is taken). A query emits either shape depending on
 * whether it selected the geometry or the feature.
 *
 * The structure is checked, not just the type name. A cell claiming to be a
 * Polygon while holding a bare position is invalid GeoJSON that MapLibre would
 * be handed and the bbox fit would walk.
 */
export function parseGeometryCell(cell: unknown): Geometry | null {
  if (cell == null || cell === '') return null

  let parsed: unknown = cell
  if (typeof cell === 'string') {
    try {
      parsed = JSON.parse(cell)
    } catch {
      return null
    }
  }

  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  if ((parsed as { type?: unknown }).type === 'Feature') {
    const geometry = (parsed as { geometry?: unknown }).geometry
    return isGeometry(geometry) ? geometry : null
  }
  return isGeometry(parsed) ? parsed : null
}
