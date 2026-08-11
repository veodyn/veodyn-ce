/**
 * Queries CRUD against the real Redash backend.
 *
 * Redash quirks: updates are POST (not PUT) to /api/queries/:id and should
 * carry `version` for optimistic-lock conflict detection (409 on stale);
 * DELETE archives — a true delete does not exist.
 */

import { redashApi, ApiError } from '@/services/api-client'
import { fetchAllPages } from '@/services/redash/paging'
import type {
  MockQuery,
  MockQueryParameter,
  MockVisualization,
} from '@/lib/mock-data'
import type { RedashPaginatedResponse, RedashQuery } from './types'

/**
 * Normalize a wire query to the shape the UI types expect: Redash list
 * serializers omit `visualizations` and send null description/runtime/
 * retrieved_at, which the Mock* types (and the components built on them)
 * treat as always-present.
 */
export function normalizeQuery(raw: RedashQuery): MockQuery {
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description ?? '',
    query: raw.query,
    data_source_id: raw.data_source_id,
    schedule: (raw.schedule ?? null) as MockQuery['schedule'],
    tags: raw.tags ?? [],
    is_archived: raw.is_archived ?? false,
    is_draft: raw.is_draft ?? false,
    is_favorite: raw.is_favorite ?? false,
    is_safe: (raw as { is_safe?: boolean }).is_safe ?? true,
    can_edit: raw.can_edit ?? false,
    user: raw.user,
    last_modified_by: raw.last_modified_by ?? raw.user,
    visualizations: (raw.visualizations ?? []) as MockVisualization[],
    latest_query_data_id: raw.latest_query_data_id ?? null,
    options: {
      parameters: (raw.options?.parameters ?? []) as unknown as MockQueryParameter[],
    },
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    retrieved_at: raw.retrieved_at ?? '',
    runtime: raw.runtime ?? 0,
    version: raw.version,
    api_key: raw.api_key,
  }
}

function normalizePage(
  raw: RedashPaginatedResponse<RedashQuery>
): RedashPaginatedResponse<MockQuery> {
  return { ...raw, results: raw.results.map(normalizeQuery) }
}

export interface QueryListParams {
  page?: number
  pageSize?: number
  search?: string
  tags?: string[]
}

function listParams(params?: QueryListParams) {
  return {
    page: params?.page ?? 1,
    page_size: params?.pageSize ?? 25,
    q: params?.search || undefined,
    tags: params?.tags?.length ? params.tags : undefined,
  }
}

/**
 * Every query, not just the first page. For screens that filter or monitor the
 * whole library rather than paging through it.
 */
export async function listAll(params?: Omit<QueryListParams, 'page' | 'pageSize'>) {
  return fetchAllPages((page, pageSize) =>
    list({ ...params, page, pageSize }) as Promise<RedashPaginatedResponse<MockQuery>>
  )
}

/**
 * Every query the caller owns, paged through.
 *
 * The profile and the My tab both render the whole set without pagination, so
 * a single 25-row page would silently drop everything after it.
 */
export async function listAllMy() {
  return fetchAllPages((page, pageSize) =>
    listMy({ page, pageSize }) as Promise<RedashPaginatedResponse<MockQuery>>
  )
}

export async function listAllFavorites() {
  return fetchAllPages((page, pageSize) =>
    listFavorites({ page, pageSize }) as Promise<RedashPaginatedResponse<MockQuery>>
  )
}

/**
 * Every archived query. The Archive tab pages in the browser like the others,
 * so it needs the whole set: a single 25-row page made everything archived
 * before the most recent 25 unreachable, and unarchiving is the only way back.
 */
export async function listAllArchived() {
  return fetchAllPages((page, pageSize) =>
    listArchived({ page, pageSize }) as Promise<RedashPaginatedResponse<MockQuery>>
  )
}

export async function list(params?: QueryListParams) {
  return normalizePage(
    await redashApi.get<RedashPaginatedResponse<RedashQuery>>('queries', {
      params: listParams(params),
    })
  )
}

/** Federated-search entry: Redash `q=` search, with a cancellation signal. */
export async function search(
  q: string,
  // `tags` narrows server-side, so a tag facet does not depend on whatever
  // happened to land on the first page. An empty `q` with a tag set is a valid
  // search: everything carrying the tag.
  opts?: { signal?: AbortSignal; tags?: string[] }
): Promise<RedashPaginatedResponse<MockQuery>> {
  return normalizePage(
    await redashApi.get<RedashPaginatedResponse<RedashQuery>>('queries', {
      params: listParams({ search: q, tags: opts?.tags }),
      signal: opts?.signal,
    })
  )
}

export async function listMy(params?: QueryListParams) {
  return normalizePage(
    await redashApi.get<RedashPaginatedResponse<RedashQuery>>('queries/my', {
      params: listParams(params),
    })
  )
}

export async function listFavorites(params?: QueryListParams) {
  return normalizePage(
    await redashApi.get<RedashPaginatedResponse<RedashQuery>>('queries/favorites', {
      params: listParams(params),
    })
  )
}

export async function listArchived(params?: QueryListParams) {
  return normalizePage(
    await redashApi.get<RedashPaginatedResponse<RedashQuery>>('queries/archive', {
      params: listParams(params),
    })
  )
}

/** GET /api/queries/recent returns a bare array (no pagination envelope). */
export async function listRecent(): Promise<{ count: number; results: MockQuery[] }> {
  const results = await redashApi.get<RedashQuery[]>('queries/recent')
  return { count: results.length, results: results.map(normalizeQuery) }
}

export async function get(id: number): Promise<MockQuery | null> {
  try {
    return normalizeQuery(await redashApi.get<RedashQuery>(`queries/${id}`))
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
}

export async function create(data: Partial<MockQuery>): Promise<MockQuery> {
  // Redash creates the default TABLE visualization server-side
  const raw = await redashApi.post<RedashQuery>('queries', {
    name: data.name || 'New Query',
    description: data.description || '',
    query: data.query || '',
    data_source_id: data.data_source_id,
    tags: data.tags || [],
    is_draft: data.is_draft ?? true,
    schedule: data.schedule ?? null,
    options: data.options ?? { parameters: [] },
  })
  // QueryListResource.post overwrites whatever is_draft the body carried with
  // True, unconditionally, so a caller asking for a query that is listed from
  // the moment it exists has to ask again. A second request rather than a
  // patched handler because the fork is kept close to upstream, and the window
  // between the two is the author's own: nobody else could list it either way.
  if (data.is_draft === false) return update(raw.id, { is_draft: false })
  return normalizeQuery(raw)
}

export async function update(
  id: number,
  changes: Partial<MockQuery>
): Promise<MockQuery> {
  return normalizeQuery(await redashApi.post<RedashQuery>(`queries/${id}`, changes))
}

/** Redash DELETE archives the query (no hard delete exists). */
export async function archive(id: number): Promise<void> {
  await redashApi.delete(`queries/${id}`)
}

/**
 * Put an archived query back. There is no dedicated endpoint: `is_archived` is
 * an ordinary updatable field, and the update handler's strip-list
 * (redash/handlers/queries.py, QueryResource.post) does not remove it.
 */
export async function unarchive(id: number): Promise<MockQuery> {
  return update(id, { is_archived: false })
}

/**
 * Rotate a query's own API key. Distinct from the user key rotated by
 * /api/users/<id>/regenerate_api_key: this one invalidates only this query's
 * result URLs. Gated server-side by require_admin_or_owner.
 */
export async function regenerateApiKey(id: number): Promise<MockQuery> {
  return normalizeQuery(await redashApi.post<RedashQuery>(`queries/${id}/regenerate_api_key`))
}

export async function fork(id: number): Promise<MockQuery> {
  return normalizeQuery(await redashApi.post<RedashQuery>(`queries/${id}/fork`))
}
