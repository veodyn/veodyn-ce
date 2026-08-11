'use client'

import { useMemo, useState, useCallback } from 'react'
import { useThemeScope } from '@/components/theme/theme-provider'
import Map, { Marker, Popup } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import type { RedashMapOptions } from '@/services/redash/types'
import { resolveSeriesColor } from '@/lib/chart-colors'

const LIGHT_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
const DARK_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

// The basemap follows the app's theme scope, not prefers-color-scheme. This
// file used to subscribe to the media query directly, on the grounds that
// nothing set the .dark class; the app now resolves the reader's choice, forced
// surfaces, and any per-widget override into one scope and publishes it for
// renderers that cannot read a CSS variable. MapLibre is exactly that.

// Redash's {{ column_name }} template syntax, resolved against a data row.
function renderTemplate(template: string, row: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const value = row[key]
    return value != null ? String(value) : ''
  })
}

function defaultPopupContent(row: Record<string, unknown>, data: QueryResultData): string {
  return data.columns.map((c) => `${c.friendly_name}: ${row[c.name] ?? ''}`).join('\n')
}

// Redash doesn't store a numeric zoom level for Map (Markers): it persists the
// last-panned viewport as `bounds` instead. For the initial render we auto-fit
// to the marker spread rather than guessing a fixed zoom.
function zoomForSpan(span: number): number {
  if (!Number.isFinite(span) || span <= 0) return 11
  return Math.min(15, Math.max(2, Math.round(Math.log2(360 / span) - 1)))
}

interface MapRendererProps {
  visualization: MockVisualization
  data: QueryResultData
}

interface MarkerData {
  lat: number
  lon: number
  popupContent: string
  group?: string
  index: number
}

export function MapRenderer({ visualization, data }: MapRendererProps) {
  const options = (visualization.options ?? {}) as RedashMapOptions
  const latCol = options.latColName || 'lat'
  const lonCol = options.lonColName || 'lon'
  const classifyCol = options.classify || undefined
  const popupTemplate = options.popup?.template
  const popupEnabled = options.popup?.enabled !== false
  const [selectedMarker, setSelectedMarker] = useState<MarkerData | null>(null)
  const isDark = useThemeScope() === 'dark'

  const hasLatLon = data.columns.some((c) => c.name === latCol) && data.columns.some((c) => c.name === lonCol)

  const markers = useMemo(() => {
    if (!hasLatLon) return []
    return data.rows
      .map((row, i) => {
        const lat = Number(row[latCol])
        const lon = Number(row[lonCol])
        if (isNaN(lat) || isNaN(lon)) return null
        return {
          lat,
          lon,
          popupContent: popupTemplate ? renderTemplate(popupTemplate, row) : defaultPopupContent(row, data),
          group: classifyCol ? String(row[classifyCol] ?? '') : undefined,
          index: i,
        }
      })
      .filter(Boolean) as MarkerData[]
  }, [data, hasLatLon, latCol, lonCol, popupTemplate, classifyCol])

  const groups = classifyCol ? [...new Set(markers.map((m) => m.group ?? ''))] : []

  const view = useMemo(() => {
    // No markers means nothing to frame, so open on the whole world rather
    // than on a particular one. This used to centre on the reference tenant's
    // downtown, which is a coordinate the identity gate cannot see: it matches
    // terms, and a latitude is not a term.
    if (markers.length === 0) return { lat: 20, lon: 0, zoom: 1 }
    const lats = markers.map((m) => m.lat)
    const lons = markers.map((m) => m.lon)
    const minLat = Math.min(...lats)
    const maxLat = Math.max(...lats)
    const minLon = Math.min(...lons)
    const maxLon = Math.max(...lons)
    return {
      lat: (minLat + maxLat) / 2,
      lon: (minLon + maxLon) / 2,
      zoom: zoomForSpan(Math.max(maxLat - minLat, maxLon - minLon)),
    }
  }, [markers])

  const handleMarkerClick = useCallback((marker: MarkerData) => {
    if (popupEnabled) setSelectedMarker(marker)
  }, [popupEnabled])

  if (!hasLatLon) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Configure latitude and longitude columns to display map.
      </div>
    )
  }

  // The map is positioned, not sized, and that is deliberate.
  //
  // A percentage height needs a containing block whose height is DEFINITE.
  // `min-h-[400px]` does not give one: it fixes the wrapper's used height at
  // 400px while its computed height stays auto, so `height: 100%` resolved to
  // zero and every map rendered as a blank panel. Wrapping the map in a
  // `flex-1` column item does not fix it either, because there the height is
  // the main axis and Chrome will not treat a grow-resolved main size as
  // definite for a percentage child. (The destination board escapes this only
  // because it is flex-row at desktop, where height is the cross axis and
  // stretch does make it definite.)
  //
  // An absolutely positioned box resolves against the containing block's
  // padding box, which uses the USED height. So it fills the wrapper however
  // the wrapper got its height: h-full, min-h, or flex.
  return (
    <div className="relative h-full min-h-[400px] w-full">
      <Map
        initialViewState={{
          latitude: view.lat,
          longitude: view.lon,
          zoom: view.zoom,
        }}
        style={{ position: 'absolute', inset: 0 }}
        mapStyle={isDark ? DARK_STYLE : LIGHT_STYLE}
      >
        {markers.map((m) => (
          <Marker
            key={m.index}
            latitude={m.lat}
            longitude={m.lon}
            anchor="bottom"
            onClick={(e) => {
              e.originalEvent.stopPropagation()
              handleMarkerClick(m)
            }}
          >
            <div
              className="w-3 h-3 rounded-full border-2 border-white shadow cursor-pointer"
              style={{ backgroundColor: m.group != null ? resolveSeriesColor(m.group, groups.indexOf(m.group)) : 'var(--primary)' }}
            />
          </Marker>
        ))}
        {selectedMarker && (
          <Popup
            latitude={selectedMarker.lat}
            longitude={selectedMarker.lon}
            onClose={() => setSelectedMarker(null)}
            closeButton
            closeOnClick={false}
            anchor="bottom"
            offset={12}
          >
            <div className="text-sm p-1 whitespace-pre-line">{selectedMarker.popupContent}</div>
          </Popup>
        )}
      </Map>
    </div>
  )
}
