'use client'

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { FeatureCollection } from 'geojson'
import { AppError, ErrorIds } from '@/lib/errorIds'

async function fetchGeoJson(mapType: string, signal?: AbortSignal): Promise<FeatureCollection> {
  // mapType is interpolated straight into the URL. Constrain it to a bare
  // static-asset name so a value like '../api/export' cannot normalize its
  // way out of /geo/ and hit an unintended same-origin route.
  if (!/^[a-z0-9_-]+$/i.test(mapType)) {
    throw new AppError(ErrorIds.UI_VIZ_GEOJSON_FAILED, 'Invalid map type', { mapType })
  }
  const res = await fetch(`/geo/${mapType}.geojson`, { signal })
  if (!res.ok) {
    throw new AppError(ErrorIds.UI_VIZ_GEOJSON_FAILED, 'Failed to load map geometry', {
      mapType,
      status: res.status,
    })
  }
  const json = await res.json()
  // A 200 response is not guaranteed to be a real FeatureCollection; validate
  // the shape before trusting the cast so a malformed body surfaces through
  // isError instead of crashing the renderer downstream.
  if (!json || typeof json !== 'object' || !Array.isArray((json as { features?: unknown }).features)) {
    throw new AppError(ErrorIds.UI_VIZ_GEOJSON_FAILED, 'Malformed map geometry', { mapType })
  }
  return json as FeatureCollection
}

/**
 * Loads the GeoJSON geometry for a choropleth `mapType` from the same-origin
 * `/geo/<mapType>.geojson` static asset. The `enabled` gate lets a caller skip
 * the fetch until it has enough config to render (e.g. key/value columns
 * mapped), so a renderer that degrades early never fires a request.
 */
export function useVizGeoJson(
  mapType: string,
  opts: { enabled?: boolean } = {}
): UseQueryResult<FeatureCollection> {
  return useQuery({
    queryKey: ['viz-geojson', mapType],
    queryFn: ({ signal }) => fetchGeoJson(mapType, signal),
    staleTime: Infinity,
    enabled: opts.enabled ?? true,
  })
}
