import type { Feature, FeatureCollection } from 'geojson'
import type { QueryResultData } from '@/lib/mock-data'
import type { RedashChoroplethOptions } from '@/services/redash/types'
import { parseGeometryCell } from './choropleth-geometry-cell'

export interface ChoroplethModel {
  featureCollection: FeatureCollection
  min: number
  max: number
  matchedCount: number
  // Rows whose geometry cell could not be read, in geometry-column mode. Always
  // 0 in map mode, where regions come from the bundled asset.
  skippedCount: number
}

interface ChoroplethColors {
  makeScale: (min: number, max: number) => (value: number) => string
  noValue: string
}

function emptyModel(skippedCount = 0): ChoroplethModel {
  return {
    featureCollection: { type: 'FeatureCollection', features: [] },
    min: 0,
    max: 0,
    matchedCount: 0,
    skippedCount,
  }
}

// A value is joinable only when it is present and finite. Rejecting null and
// '' before Number(...) matters: both coerce to 0, which would turn a no-data
// row into a matched region shaded at the bottom of the scale.
function numericValue(raw: unknown): number | undefined {
  if (raw == null || raw === '') return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

function domain(values: number[]): { min: number; max: number } {
  if (!values.length) return { min: 0, max: 0 }
  return { min: Math.min(...values), max: Math.max(...values) }
}

// Geometry-column mode: each row IS a region, so there is nothing to match.
// The row's own key labels the feature and its own value shades it.
function buildFromGeometryColumn(
  options: RedashChoroplethOptions,
  data: QueryResultData,
  colors: ChoroplethColors
): ChoroplethModel {
  const { keyColumn, valueColumn, geometryColumn } = options
  if (!geometryColumn) return emptyModel()

  const regions: { geometry: NonNullable<Feature['geometry']>; key: unknown; value: number | undefined }[] = []
  let skippedCount = 0
  for (const row of data.rows) {
    const geometry = parseGeometryCell(row[geometryColumn])
    if (!geometry) {
      skippedCount += 1
      continue
    }
    regions.push({
      geometry,
      key: keyColumn ? row[keyColumn] : undefined,
      value: valueColumn ? numericValue(row[valueColumn]) : undefined,
    })
  }

  const { min, max } = domain(regions.map((region) => region.value).filter((value): value is number => value != null))
  const scale = colors.makeScale(min, max)

  let matchedCount = 0
  const features: Feature[] = regions.map(({ geometry, key, value }) => {
    const matched = value != null
    if (matched) matchedCount += 1
    return {
      type: 'Feature',
      geometry,
      properties: {
        ...(keyColumn ? { [keyColumn]: key ?? null } : {}),
        __key: key == null ? null : String(key),
        __value: matched ? value : null,
        fillColor: matched ? scale(value as number) : colors.noValue,
      },
    }
  })

  return { featureCollection: { type: 'FeatureCollection', features }, min, max, matchedCount, skippedCount }
}

// Pure join and color: no React, no fetch, no MapLibre. Given the choropleth
// options, a query result, and geometry, produces a colored FeatureCollection
// plus min, max, and the matched-region count. The color scale is injected
// (colors.makeScale) so this stays testable without the DOM; the renderer
// passes getSequentialScaleHex for concrete WebGL fills.
export function buildChoroplethModel(
  options: RedashChoroplethOptions,
  data: QueryResultData,
  geojson: FeatureCollection,
  colors: ChoroplethColors
): ChoroplethModel {
  if (options.boundarySource === 'column') {
    return buildFromGeometryColumn(options, data, colors)
  }

  // A 200 response that is not a real FeatureCollection (missing or non-array
  // features) must degrade to the renderer's no-data state, not throw.
  if (!geojson || !Array.isArray(geojson.features)) {
    return emptyModel()
  }

  const { keyColumn, valueColumn, targetField } = options
  const valueByKey = new Map<string, number>()

  if (keyColumn && valueColumn) {
    for (const row of data.rows) {
      const key = row[keyColumn]
      if (key == null || key === '') continue
      const value = numericValue(row[valueColumn])
      if (value == null) continue
      valueByKey.set(String(key), value)
    }
  }

  // Resolve each feature's joined value before picking a domain, so the scale
  // reflects only values that actually land on a region. A row that never
  // joins to a geometry feature (e.g. an outlier key with no matching
  // country) must not widen the domain and compress the matched regions.
  const joined = geojson.features.map((feature) => {
    const featureKey = targetField ? feature.properties?.[targetField] : undefined
    const value = featureKey != null ? valueByKey.get(String(featureKey)) : undefined
    return { feature, featureKey, value }
  })

  const { min, max } = domain(joined.map((entry) => entry.value).filter((value): value is number => value != null))
  const scale = colors.makeScale(min, max)

  let matchedCount = 0
  const features: Feature[] = joined.map(({ feature, featureKey, value }) => {
    const matched = value != null
    if (matched) matchedCount += 1
    return {
      ...feature,
      properties: {
        ...feature.properties,
        // The tooltip labels a region from __key in both modes. Here it is the
        // property the join matched on, which is the only name the bundled
        // geometry carries that the analyst chose.
        __key: featureKey == null ? null : String(featureKey),
        __value: matched ? value : null,
        fillColor: matched ? scale(value as number) : colors.noValue,
      },
    }
  })

  return {
    featureCollection: { type: 'FeatureCollection', features },
    min,
    max,
    matchedCount,
    skippedCount: 0,
  }
}
