import type { QueryResultData } from '@/lib/mock-data'

const LATITUDE = ['lat', 'latitude', 'stop_lat', 'y']
const LONGITUDE = ['lng', 'lon', 'longitude', 'stop_lon', 'x']

export function inferMapColumnMapping(
  data: QueryResultData
): { latColName: string; lonColName: string } | Record<string, never> {
  const names = new Set(data.columns.map((column) => column.name))
  const latColName = LATITUDE.find((candidate) => names.has(candidate))
  const lonColName = LONGITUDE.find((candidate) => names.has(candidate))
  if (latColName == null || lonColName == null) return {}
  return { latColName, lonColName }
}

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
