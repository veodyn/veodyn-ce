import type { Feature, FeatureCollection } from 'geojson'
import type { QueryResultData } from '@/lib/mock-data'
import type { RedashChoroplethOptions } from '@/services/redash/types'

export interface ChoroplethModel {
  featureCollection: FeatureCollection
  min: number
  max: number
  matchedCount: number
}

interface ChoroplethColors {
  makeScale: (min: number, max: number) => (value: number) => string
  noValue: string
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
  // A 200 response that is not a real FeatureCollection (missing or non-array
  // features) must degrade to the renderer's no-data state, not throw.
  if (!geojson || !Array.isArray(geojson.features)) {
    return { featureCollection: { type: 'FeatureCollection', features: [] }, min: 0, max: 0, matchedCount: 0 }
  }

  const { keyColumn, valueColumn, targetField } = options
  const valueByKey = new Map<string, number>()

  if (keyColumn && valueColumn) {
    for (const row of data.rows) {
      const key = row[keyColumn]
      if (key == null || key === '') continue
      const raw = row[valueColumn]
      // Reject null/empty BEFORE Number(...): Number(null) and Number('') are
      // both 0, which would otherwise turn a no-data row into a matched
      // region with a value of 0 instead of staying unmatched.
      if (raw == null || raw === '') continue
      const value = Number(raw)
      if (!Number.isFinite(value)) continue
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
    return { feature, value }
  })

  const matchedValues = joined.filter((entry) => entry.value != null).map((entry) => entry.value as number)
  const min = matchedValues.length ? Math.min(...matchedValues) : 0
  const max = matchedValues.length ? Math.max(...matchedValues) : 0
  const scale = colors.makeScale(min, max)

  let matchedCount = 0
  const features: Feature[] = joined.map(({ feature, value }) => {
    const matched = value != null
    if (matched) matchedCount += 1
    return {
      ...feature,
      properties: {
        ...feature.properties,
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
  }
}
