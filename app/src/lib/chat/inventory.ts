import { getJson, type Access } from './redash-get'
import { RESOURCE_SECTION_RE } from './resource-section'
import { TURN_CONTEXT_LIMITS, type DataSourceEntry } from './turn-context'
import { ttlCache } from './ttl-cache'

export const RESOURCE_CACHE_TTL_MS = 10 * 60 * 1000
export const RESOURCE_NEGATIVE_TTL_MS = 60 * 1000
export const RESOURCE_CACHE_ENTRIES = 200
export const SOURCE_LIST_TTL_MS = 30 * 1000
export const SOURCE_LIST_ENTRIES = 50

interface RawDataSource {
  id: number
  name: string
  type: string
  syntax?: string
  view_only?: boolean
}

interface RawSchemaEntry {
  name?: unknown
}

const resourceCache = ttlCache<number, string[] | null>(RESOURCE_CACHE_TTL_MS, RESOURCE_CACHE_ENTRIES)
const sourceListCache = ttlCache<string, RawDataSource[]>(SOURCE_LIST_TTL_MS, SOURCE_LIST_ENTRIES)

export function resourceNamesFrom(entries: RawSchemaEntry[]): string[] {
  const names = new Set<string>()
  for (const entry of entries) {
    if (typeof entry.name !== 'string') continue
    const match = RESOURCE_SECTION_RE.exec(entry.name)
    if (match) names.add(match[2])
  }
  return [...names]
}

async function fetchResourceNames(id: number, access: Access): Promise<string[] | null> {
  const cached = resourceCache.get(id)
  if (cached !== undefined) return cached
  const body = await getJson<{ schema?: RawSchemaEntry[] }>(`/api/data_sources/${id}/schema`, access)
  if (Array.isArray(body?.schema)) {
    const names = resourceNamesFrom(body.schema)
    resourceCache.set(id, names)
    return names
  }
  if (!access.signal.aborted) resourceCache.set(id, null, RESOURCE_NEGATIVE_TTL_MS)
  return null
}

async function entryFor(source: RawDataSource, access: Access): Promise<DataSourceEntry> {
  const syntax = source.syntax ?? 'sql'
  const entry: DataSourceEntry = {
    id: source.id,
    name: source.name,
    type: source.type,
    syntax,
    viewOnly: source.view_only ?? false,
  }
  if (source.type === 'results') return { ...entry, noSchema: true }
  if (syntax !== 'json') return entry
  return { ...entry, resources: await fetchResourceNames(source.id, access) }
}

async function sourceList(access: Access): Promise<RawDataSource[]> {
  const key = access.cookie ?? ''
  const cached = sourceListCache.get(key)
  if (cached) return cached
  const sources = await getJson<RawDataSource[]>('/api/data_sources', access)
  if (!Array.isArray(sources)) throw new Error('data source list unavailable')
  if (!access.signal.aborted) sourceListCache.set(key, sources)
  return sources
}

export async function dataSourceInventory(cookie: string | null, signal: AbortSignal): Promise<DataSourceEntry[]> {
  const access: Access = { cookie, signal }
  const sources = await sourceList(access)
  return Promise.all(sources.slice(0, TURN_CONTEXT_LIMITS.dataSources).map((source) => entryFor(source, access)))
}
