'use client'

import { useCallback, useMemo, useState } from 'react'
import Map, { Source, Layer, Popup, type MapLayerMouseEvent } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { FeatureCollection } from 'geojson'
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
import { choroplethTooltipText } from './choropleth-tooltip'
import { WORLD_VIEW, viewForFeatureCollection } from './choropleth-view'
import { FILLABLE_PANEL_HEIGHT } from '@/lib/chart-marks'

const LIGHT_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
// This map used to have no dark basemap at all, so a dark app got white
// countries on a white page. useThemeTokenVersion below already re-bakes the
// fill colours when the theme changes; the basemap under them was the one part
// that never moved.
const DARK_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

const NO_GEOJSON: FeatureCollection = { type: 'FeatureCollection', features: [] }

// The fill layer has to be named for MapLibre to hit-test it; without this the
// hover event carries no features and the tooltip never opens.
const INTERACTIVE_LAYERS = ['choropleth-fills']

interface HoveredRegion {
  longitude: number
  latitude: number
  text: string
}

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
  // Absent means the bundled map, so every choropleth saved before this option
  // existed keeps its geometry source.
  const fromColumn = options.boundarySource === 'column'
  const hasColumns = Boolean(options.keyColumn && options.valueColumn)
  // Gate the fetch on a valid config so the early degradation path never fires
  // an unhandled request, and skip it entirely when the regions come from the
  // result: there is no asset to load.
  const { data: geojson, isLoading, isError } = useVizGeoJson(mapType, { enabled: hasColumns && !fromColumn })
  const themeVersion = useThemeTokenVersion()
  const isDark = useThemeScope() === 'dark'

  const model = useMemo(() => {
    if (!options.keyColumn || !options.valueColumn) return null
    if (!fromColumn && !geojson) return null
    return buildChoroplethModel(options, data, geojson ?? NO_GEOJSON, {
      makeScale: getSequentialScaleHex,
      noValue: readCssVarHex('--muted', MUTED_FALLBACK_HEX),
    })
    // themeVersion is not read in the body: it is the signal that the CSS
    // custom properties this model resolved have changed underneath it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geojson, options, data, themeVersion, fromColumn])

  const initialViewState = useMemo(
    () => (fromColumn && model ? viewForFeatureCollection(model.featureCollection) : WORLD_VIEW),
    [fromColumn, model]
  )

  const [hovered, setHovered] = useState<HoveredRegion | null>(null)

  const handleMouseMove = useCallback((event: MapLayerMouseEvent) => {
    const feature = event.features?.[0]
    const text = feature ? choroplethTooltipText(feature.properties) : ''
    if (!text) {
      setHovered(null)
      return
    }
    setHovered({ longitude: event.lngLat.lng, latitude: event.lngLat.lat, text })
  }, [])

  const handleMouseLeave = useCallback(() => setHovered(null), [])

  if (!options.keyColumn || !options.valueColumn) {
    return <div className="p-4 text-sm text-muted-foreground">Choropleth requires key and value columns.</div>
  }
  if (fromColumn && !options.geometryColumn) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Choropleth needs a geometry column when the boundaries come from the query result.
      </div>
    )
  }
  if (isError) {
    return <div className="p-4 text-sm text-muted-foreground">Map geometry is unavailable in this context.</div>
  }
  if (isLoading || !model) {
    return <div className="p-4 text-sm text-muted-foreground">Loading map geometry...</div>
  }
  if (fromColumn) {
    // Regions with no value still say where the districts are, so only an empty
    // set of them is an empty state here.
    if (model.featureCollection.features.length === 0) {
      return (
        <div className="p-4 text-sm text-muted-foreground">
          No region geometry could be read from the &quot;{options.geometryColumn}&quot; column.
        </div>
      )
    }
  } else if (model.matchedCount === 0) {
    return <div className="p-4 text-sm text-muted-foreground">No regions matched the key column.</div>
  }

  const outline = readCssVarHex('--border', BORDER_FALLBACK_HEX)

  return (
    <div className="w-full">
      <div className="w-full" style={{ height: FILLABLE_PANEL_HEIGHT }}>
        <Map
          initialViewState={initialViewState}
          style={{ width: '100%', height: '100%' }}
          mapStyle={isDark ? DARK_STYLE : LIGHT_STYLE}
          interactiveLayerIds={INTERACTIVE_LAYERS}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
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
          {hovered ? (
            <Popup
              longitude={hovered.longitude}
              latitude={hovered.latitude}
              closeButton={false}
              closeOnClick={false}
              offset={8}
            >
              {/* A text child, so a region name out of the result is shown and
                  not interpreted. */}
              {hovered.text}
            </Popup>
          ) : null}
        </Map>
      </div>
      {model.skippedCount > 0 ? (
        <p className="px-4 pt-2 text-xs text-muted-foreground">
          {model.skippedCount === 1
            ? '1 row had unreadable geometry and is not on the map.'
            : `${model.skippedCount} rows had unreadable geometry and are not on the map.`}
        </p>
      ) : null}
    </div>
  )
}
