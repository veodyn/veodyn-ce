import '@/plugins'
import { config } from '@/lib/config'
import { visibilityOf, visibleVizChoices, type VizChoice } from '@/lib/viz-choices'
import { getJson, type Access } from './redash-get'
import { TURN_CONTEXT_LIMITS, type ReadyParam, type ReadyQuery } from './turn-context'
import { ttlCache } from './ttl-cache'

export const TAGGED_PAGE_SIZE = 50
export const DETAIL_CONCURRENCY = 8
export const READY_CACHE_TTL_MS = 60 * 1000
export const READY_CACHE_ENTRIES = 50

interface RawParameter {
  name?: unknown
  type?: unknown
  value?: unknown
  queryId?: unknown
}

interface RawVisualization {
  id: number
  type: string
}

interface RawQuery {
  id: number
  name: string
  data_source_id: number
  is_archived?: boolean
  latest_query_data_id?: number | null
  options?: { parameters?: RawParameter[] }
  visualizations?: RawVisualization[]
}

interface StoredData {
  columns: { name: string }[]
  rows: Record<string, unknown>[]
}

interface Candidate {
  choice: VizChoice
  id: number
  more: boolean
}

interface Run {
  access: Access
  failed: boolean
  details: Map<number, Promise<RawQuery | null>>
  backing: Map<number, Promise<string[]>>
}

const cache = ttlCache<string, ReadyQuery[]>(READY_CACHE_TTL_MS, READY_CACHE_ENTRIES)
const inflight = new Map<string, Promise<ReadyQuery[]>>()

async function get<T>(run: Run, path: string): Promise<T | null> {
  const body = await getJson<T>(path, run.access)
  if (body === null) run.failed = true
  return body
}

function detail(run: Run, id: number): Promise<RawQuery | null> {
  let pending = run.details.get(id)
  if (!pending) {
    pending = get<RawQuery>(run, `/api/queries/${id}`)
    run.details.set(id, pending)
  }
  return pending
}

async function mapLimit<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length)
  let next = 0
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++
      results[index] = await work(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

function scalar(value: unknown): string | number | null {
  return typeof value === 'string' || typeof value === 'number' ? value : null
}

function dropdownValues(data: StoredData): string[] {
  const first = data.columns[0]?.name
  if (first === undefined) return []
  const named = data.columns.find((column) => column.name.toLowerCase() === 'value')?.name ?? first
  return data.rows.map((row) => String(row[named]))
}

async function backingValues(run: Run, queryId: number): Promise<string[]> {
  const backing = await detail(run, queryId)
  if (!backing?.latest_query_data_id) return []
  const stored = await get<{ query_result?: { data?: StoredData } }>(
    run,
    `/api/query_results/${backing.latest_query_data_id}`
  )
  const data = stored?.query_result?.data
  return data ? dropdownValues(data) : []
}

async function paramFor(run: Run, raw: RawParameter): Promise<ReadyParam> {
  const name = String(raw.name ?? '')
  const type = String(raw.type ?? 'text')
  const param: ReadyParam = { name, type, values: [] }
  const defaultValue = scalar(raw.value)
  if (defaultValue !== null) param.default = defaultValue
  if (type !== 'query' || typeof raw.queryId !== 'number') return param
  const queryId = raw.queryId
  if (!run.backing.has(queryId)) run.backing.set(queryId, backingValues(run, queryId))
  const all = (await run.backing.get(queryId)) ?? []
  return {
    ...param,
    backingQueryId: queryId,
    values: all.slice(0, TURN_CONTEXT_LIMITS.paramValues),
    ...(all.length > TURN_CONTEXT_LIMITS.paramValues ? { valuesTruncated: true } : {}),
  }
}

async function readyFor(run: Run, candidate: Candidate): Promise<ReadyQuery | null> {
  const raw = await detail(run, candidate.id)
  if (!raw || raw.is_archived) return null
  const visualization = raw.visualizations?.find((one) => one.type === candidate.choice.type)
  if (!visualization) return null
  const params = await Promise.all(
    (raw.options?.parameters ?? []).slice(0, TURN_CONTEXT_LIMITS.params).map((parameter) => paramFor(run, parameter))
  )
  return {
    choiceId: candidate.choice.id,
    queryId: raw.id,
    name: raw.name,
    dataSourceId: raw.data_source_id,
    visualizationId: visualization.id,
    params,
    more: candidate.more,
  }
}

async function candidatesFor(run: Run, choices: VizChoice[]): Promise<Candidate[]> {
  const listed = await Promise.all(
    choices.map(async (choice) => ({
      choice,
      listing: await get<{ count?: number; results?: { id: number }[] }>(
        run,
        `/api/queries?tags=${encodeURIComponent(choice.libraryTag ?? '')}&page_size=${TAGGED_PAGE_SIZE}`
      ),
    }))
  )
  return listed.flatMap(({ choice, listing }) => {
    const tagged = listing?.results ?? []
    const more = (listing?.count ?? 0) > tagged.length
    return tagged.map((one) => ({ choice, id: one.id, more }))
  })
}

async function fanOut(choices: VizChoice[], access: Access): Promise<{ queries: ReadyQuery[]; clean: boolean }> {
  const run: Run = { access, failed: false, details: new Map(), backing: new Map() }
  const candidates = await candidatesFor(run, choices)
  const cap = TURN_CONTEXT_LIMITS.readyQueries
  const found: ReadyQuery[] = []
  let next = 0
  while (found.length < cap && next < candidates.length) {
    const wave = candidates.slice(next, next + cap - found.length)
    next += wave.length
    const built = await mapLimit(wave, DETAIL_CONCURRENCY, (candidate) => readyFor(run, candidate))
    found.push(...built.filter((one): one is ReadyQuery => one !== null))
  }
  const queries = next < candidates.length ? found.map((one) => ({ ...one, more: true })) : found
  return { queries, clean: !run.failed && !access.signal.aborted }
}

export async function readyQueries(cookie: string | null, signal: AbortSignal): Promise<ReadyQuery[]> {
  const tagged = visibleVizChoices(visibilityOf(config)).filter((choice) => choice.libraryTag)
  if (tagged.length === 0) return []
  const key = cookie ?? ''
  const hit = cache.get(key)
  if (hit) return hit
  const pending = inflight.get(key)
  if (pending) return pending
  const job = fanOut(tagged, { cookie, signal })
    .then(({ queries, clean }) => {
      if (clean) cache.set(key, queries)
      return queries
    })
    .finally(() => inflight.delete(key))
  inflight.set(key, job)
  return job
}
