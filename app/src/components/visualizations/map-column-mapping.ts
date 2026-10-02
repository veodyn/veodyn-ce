// Which columns a marker map should read as coordinates.
//
// The MAP plugin's defaultOptions name `lat` and `lon`, which is a guess that
// is right often enough for a hand-written query and wrong for everything else:
// `latitude`/`longitude` from a geocoder, `lng` from a GTFS-RT vehicle feed,
// `stop_lat`/`stop_lon` from a GTFS table. Nothing corrected it, because unlike
// the chart and the heatmap the map has no positional fallback to fall back
// TO — a marker layer handed a column name that is not in the result reads
// undefined per row and draws an empty basemap.
//
// That is invisible in the one place it matters most. An analyst who picks Map
// in the edit dialog sees the column selectors and fixes them; a map created
// without an editor (an AI-authored widget, a seeded dashboard) has nobody to
// notice, and an empty basemap looks like a query that returned nothing.
import type { QueryResultData } from '@/lib/mock-data'

// Ordered by how specific the name is, not alphabetically: a result carrying
// both `lat` and `latitude` means the same thing twice, and the short form is
// what the renderer's own default already assumed.
const LATITUDE = ['lat', 'latitude', 'stop_lat', 'y']
// `lng` before `lon` deliberately. Both appear, and a result with both is a
// join of two feeds rather than one feed spelling it twice, in which case the
// vehicle position (`lng`, what GTFS-RT and the RIITS vehiclelocations resource
// return) is the one somebody wants pinned.
const LONGITUDE = ['lng', 'lon', 'longitude', 'stop_lon', 'x']

/**
 * The coordinate columns this result implies, or `{}` when it implies none.
 *
 * Both or neither, on the same rule inferChartColumnMapping and
 * inferHeatmapColumnMapping follow: half a mapping is worse than none, because
 * a latitude with no longitude still draws nothing and now claims to be
 * configured.
 */
export function inferMapColumnMapping(
  data: QueryResultData
): { latColName: string; lonColName: string } | Record<string, never> {
  const names = new Set(data.columns.map((column) => column.name))
  const latColName = LATITUDE.find((candidate) => names.has(candidate))
  const lonColName = LONGITUDE.find((candidate) => names.has(candidate))
  if (latColName == null || lonColName == null) return {}
  return { latColName, lonColName }
}

/**
 * The MAP plugin's `inferOptions`.
 *
 * Unlike the chart's and the heatmap's, this one overwrites what it is handed.
 * Those two leave an existing `columnMapping` alone, because an empty one means
 * "never chosen". MAP has no such signal: its defaultOptions GUESS `lat` and
 * `lon`, so an untouched map and one an analyst deliberately pointed at a
 * column called `lat` are the same object.
 *
 * Resolving against the result is what tells them apart. A name the query
 * actually returns is the analyst's, and is kept even when the candidate lists
 * above would have picked something else; a name it does not return cannot be
 * anyone's intent, because it draws nothing. Only the second is repointed.
 */
export function mapCoordinateOptions(
  defaults: Record<string, unknown>,
  data: QueryResultData
): Record<string, unknown> {
  const names = new Set(data.columns.map((column) => column.name))
  const resolves = (key: string) => typeof defaults[key] === 'string' && names.has(defaults[key])
  if (resolves('latColName') && resolves('lonColName')) return defaults
  const inferred = inferMapColumnMapping(data)
  return Object.keys(inferred).length > 0 ? { ...defaults, ...inferred } : defaults
}
