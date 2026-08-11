// Data Catalog contract types. Shared by the mock fixtures, the /api/catalog and
// /api/domains/[key] route handlers, the client service, the hooks, and the UI.
// The backend track implements the same shapes; the mock store is the stand-in
// until it does (MVP spec section 4).

export interface DatasetColumn {
  name: string
  type: string
  description?: string
}

export interface DatasetFreshness {
  lastUpdatedAt: string // ISO 8601
  status: 'fresh' | 'stale'
  feedId?: string // upstream feed id; the Feed Health board (plan 09) keys off this
}

export interface DatasetCoverage {
  start: string // ISO 8601 (earliest row)
  end: string // ISO 8601 (latest row)
}

export interface Dataset {
  id: string // stable slug used in /data/dataset/[datasetId]
  name: string
  description: string
  domain: string | null // domain key (see DomainHub.key), or null when uncategorized
  schema: DatasetColumn[]
  freshness: DatasetFreshness
  coverage: DatasetCoverage
  rowCount: number
  sources: string[] // upstream source / feed names
  tags: string[]
  sampleQueryId: number | null // seeds demo scenario (b): "Query this dataset"
}

export interface HubCounter {
  label: string
  value: number
  unit?: string // e.g. '%', 'ms', 'k'
  delta?: number // signed period-over-period change; undefined = no delta chip
  // The unit `delta` is expressed in, when it is not `unit`. A counter over an
  // absolute count usually moves by a percentage, not by that many items: the
  // AI digest already phrases every mover as "moved up N%", so a counter whose
  // delta means that has to say so rather than render a bare number.
  deltaUnit?: string
  queryId?: number // the mock query this counter is wired to
  kpiId?: string // when set, HubCounterRow renders a live KpiScorecard (KPI spec section 5)
}

export interface DomainHub {
  key: string // stable id used in /data/[domain]; matches a config domain key
  label: string
  icon?: string // lucide icon name (resolveDomainIcon in sidebar-nav.ts)
  datasetIds: string[]
  dashboardIds: number[]
  counters: HubCounter[]
}
