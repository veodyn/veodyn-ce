'use client'

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { FeatureCollection } from 'geojson'
import { VizError, VIZ_ERROR_IDS } from '@/lib/visualizations/viz-error'
import { geoJsonUrl, useVizEnvironment } from '@/lib/viz-environment'

async function fetchGeoJson(assetsUrl: string, mapType: string, signal?: AbortSignal): Promise<FeatureCollection> {
  // mapType is interpolated straight into the URL. Constrain it to a bare
  // static-asset name so a value like '../api/export' cannot normalize its
  // way out of /geo/ and hit an unintended same-origin route.
  if (!/^[a-z0-9_-]+$/i.test(mapType)) {
    throw new VizError(VIZ_ERROR_IDS.GEOJSON_FAILED, 'Invalid map type', { mapType })
  }
  const res = await fetch(geoJsonUrl(assetsUrl, mapType), { signal })
  if (!res.ok) {
    throw new VizError(VIZ_ERROR_IDS.GEOJSON_FAILED, 'Failed to load map geometry', {
      mapType,
      status: res.status,
    })
  }
  const json = await res.json()
  // A 200 response is not guaranteed to be a real FeatureCollection; validate
  // the shape before trusting the cast so a malformed body surfaces through
  // isError instead of crashing the renderer downstream.
  if (!json || typeof json !== 'object' || !Array.isArray((json as { features?: unknown }).features)) {
    throw new VizError(VIZ_ERROR_IDS.GEOJSON_FAILED, 'Malformed map geometry', { mapType })
  }
  return json as FeatureCollection
}

/**
 * Loads the GeoJSON geometry for a choropleth `mapType` from the same-origin
 * `/geo/<mapType>.geojson` static asset. The `enabled` gate lets a caller skip
 * the fetch until it has enough config to render (e.g. key/value columns
 * mapped), so a renderer that degrades early never fires a request.
 */
const RETRYABLE_CLIENT_STATUSES = new Set([408, 429])

function retryGeoJson(failureCount: number, error: Error): boolean {
  const status = error instanceof VizError ? error.context.status : undefined
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return RETRYABLE_CLIENT_STATUSES.has(status) && failureCount < 3
  }
  return failureCount < 3
}

export function useVizGeoJson(
  mapType: string,
  opts: { enabled?: boolean } = {}
): UseQueryResult<FeatureCollection> {
  const { assetsUrl } = useVizEnvironment()
  return useQuery({
    queryKey: ['viz-geojson', assetsUrl, mapType],
    queryFn: ({ signal }) => fetchGeoJson(assetsUrl, mapType, signal),
    staleTime: Infinity,
    retry: retryGeoJson,
    enabled: opts.enabled ?? true,
  })
}
