import type { FeatureCollection, Geometry, Position } from 'geojson'

export interface ChoroplethView {
  latitude: number
  longitude: number
  zoom: number
}

/** The bundled world map's opening view, and the fallback with nothing to frame. */
export const WORLD_VIEW: ChoroplethView = { latitude: 20, longitude: 0, zoom: 1 }

// Same span-to-zoom curve the marker map uses (map-renderer.tsx), so the two
// maps open at comparable scale for comparable data.
function zoomForSpan(span: number): number {
  if (!Number.isFinite(span) || span <= 0) return 11
  return Math.min(15, Math.max(2, Math.round(Math.log2(360 / span) - 1)))
}

interface Bounds {
  minLon: number
  maxLon: number
  minLat: number
  maxLat: number
  found: boolean
}

function visit(coordinates: unknown, bounds: Bounds): void {
  if (!Array.isArray(coordinates)) return
  if (typeof coordinates[0] === 'number') {
    const [lon, lat] = coordinates as Position
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return
    bounds.minLon = Math.min(bounds.minLon, lon)
    bounds.maxLon = Math.max(bounds.maxLon, lon)
    bounds.minLat = Math.min(bounds.minLat, lat)
    bounds.maxLat = Math.max(bounds.maxLat, lat)
    bounds.found = true
    return
  }
  for (const entry of coordinates) visit(entry, bounds)
}

function visitGeometry(geometry: Geometry | null, bounds: Bounds): void {
  if (!geometry) return
  if (geometry.type === 'GeometryCollection') {
    // Guarded rather than trusted: a FeatureCollection reaching here has not
    // been through parseGeometryCell, and a collection with no `geometries` is
    // valid JSON that would throw mid-walk.
    if (!Array.isArray(geometry.geometries)) return
    for (const nested of geometry.geometries) visitGeometry(nested, bounds)
    return
  }
  visit(geometry.coordinates, bounds)
}

/**
 * The opening viewport for a set of region outlines, fitted to their extent.
 *
 * Geometry read from a query column can be a city's census tracts or one
 * country's provinces, so the world view the bundled map opens on would leave
 * them a speck.
 */
export function viewForFeatureCollection(featureCollection: FeatureCollection): ChoroplethView {
  const bounds: Bounds = {
    minLon: Infinity,
    maxLon: -Infinity,
    minLat: Infinity,
    maxLat: -Infinity,
    found: false,
  }
  for (const feature of featureCollection.features ?? []) visitGeometry(feature.geometry, bounds)
  if (!bounds.found) return WORLD_VIEW

  return {
    longitude: (bounds.minLon + bounds.maxLon) / 2,
    latitude: (bounds.minLat + bounds.maxLat) / 2,
    zoom: zoomForSpan(Math.max(bounds.maxLon - bounds.minLon, bounds.maxLat - bounds.minLat)),
  }
}
