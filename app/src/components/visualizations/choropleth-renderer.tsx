'use client'

import { useMemo } from 'react'
import Map, { Source, Layer } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import type { RedashChoroplethOptions } from '@/services/redash/types'
import {
  BORDER_FALLBACK_HEX,
  MUTED_FALLBACK_HEX,
  getSequentialScaleHex,
  readCssVarHex,
} from '@/lib/chart-colors'
import { useVizGeoJson } from '@/hooks/use-viz-geojson'
import { useThemeTokenVersion } from '@/hooks/use-theme-token-version'
import { useThemeScope } from '@/components/theme/theme-provider'
import { buildChoroplethModel } from './choropleth-model'
import { FILLABLE_PANEL_HEIGHT } from '@/lib/chart-marks'

const LIGHT_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
// This map used to have no dark basemap at all, so a dark app got white
// countries on a white page. useThemeTokenVersion below already re-bakes the
// fill colours when the theme changes; the basemap under them was the one part
// that never moved.
const DARK_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

interface ChoroplethRendererProps {
  visualization: MockVisualization
  data: QueryResultData
}

export function ChoroplethRenderer({ visualization, data }: ChoroplethRendererProps) {
  const options = useMemo(
    () => (visualization.options ?? {}) as RedashChoroplethOptions,
    [visualization.options]
  )
  const mapType = options.mapType ?? 'world-countries'
  const hasColumns = Boolean(options.keyColumn && options.valueColumn)
  // Gate the fetch on a valid config so the early degradation path never fires
  // an unhandled request.
  const { data: geojson, isLoading, isError } = useVizGeoJson(mapType, { enabled: hasColumns })
  const themeVersion = useThemeTokenVersion()
  const isDark = useThemeScope() === 'dark'

  const model = useMemo(() => {
    if (!geojson || !options.keyColumn || !options.valueColumn) return null
    return buildChoroplethModel(options, data, geojson, {
      makeScale: getSequentialScaleHex,
      noValue: readCssVarHex('--muted', MUTED_FALLBACK_HEX),
    })
    // themeVersion is not read in the body: it is the signal that the CSS
    // custom properties this model resolved have changed underneath it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geojson, options, data, themeVersion])

  if (!options.keyColumn || !options.valueColumn) {
    return <div className="p-4 text-sm text-muted-foreground">Choropleth requires key and value columns.</div>
  }
  if (isError) {
    return <div className="p-4 text-sm text-muted-foreground">Map geometry is unavailable in this context.</div>
  }
  if (isLoading || !model) {
    return <div className="p-4 text-sm text-muted-foreground">Loading map geometry...</div>
  }
  if (model.matchedCount === 0) {
    return <div className="p-4 text-sm text-muted-foreground">No regions matched the key column.</div>
  }

  const outline = readCssVarHex('--border', BORDER_FALLBACK_HEX)

  return (
    <div className="w-full" style={{ height: FILLABLE_PANEL_HEIGHT }}>
      <Map
        initialViewState={{ latitude: 20, longitude: 0, zoom: 1 }}
        style={{ width: '100%', height: '100%' }}
        mapStyle={isDark ? DARK_STYLE : LIGHT_STYLE}
      >
        <Source id="choropleth-regions" type="geojson" data={model.featureCollection}>
          <Layer
            id="choropleth-fills"
            type="fill"
            paint={{
              'fill-color': ['get', 'fillColor'],
              'fill-opacity': 0.85,
              'fill-outline-color': outline,
            }}
          />
        </Source>
      </Map>
    </div>
  )
}
