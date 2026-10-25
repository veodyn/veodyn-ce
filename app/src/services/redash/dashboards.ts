/**
 * Dashboards against the real Redash backend.
 *
 * Redash quirks: updates are POST (not PUT) to /api/dashboards/:id with
 * `version` for optimistic locking; DELETE archives; sharing is a
 * POST/DELETE on /api/dashboards/:id/share. There is no fork endpoint.
 */

import { redashApi, ApiError } from '@/services/api-client'
import { fetchAllPages } from '@/services/redash/paging'
import type { MockDashboard } from '@/lib/mock-data'
import { normalizeDashboard, normalizeWidget } from './normalize-dashboard'
import type { RedashDashboard, RedashPaginatedResponse } from './types'

export { normalizeDashboard, normalizeWidget }

function normalizePage(
  raw: RedashPaginatedResponse<RedashDashboard>
): RedashPaginatedResponse<MockDashboard> {
  return { ...raw, results: raw.results.map(normalizeDashboard) }
}

export interface DashboardListParams {
  page?: number
  pageSize?: number
  search?: string
  tags?: string[]
}

function listParams(params?: DashboardListParams) {
  return {
    page: params?.page ?? 1,
    page_size: params?.pageSize ?? 25,
    q: params?.search || undefined,
    tags: params?.tags?.length ? params.tags : undefined,
  }
}

export async function list(params?: DashboardListParams) {
  return normalizePage(
    await redashApi.get<RedashPaginatedResponse<RedashDashboard>>('dashboards', {
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
  opts?: { signal?: AbortSignal; tags?: string[]; pageSize?: number }
): Promise<RedashPaginatedResponse<MockDashboard>> {
  return normalizePage(
    await redashApi.get<RedashPaginatedResponse<RedashDashboard>>('dashboards', {
      params: listParams({ search: q, tags: opts?.tags, pageSize: opts?.pageSize }),
      signal: opts?.signal,
    })
  )
}

export async function listMy(params?: DashboardListParams) {
  return normalizePage(
    await redashApi.get<RedashPaginatedResponse<RedashDashboard>>('dashboards/my', {
      params: listParams(params),
    })
  )
}

/**
 * Every dashboard, not just the first page. The library list pages in the
 * browser so it can sort the whole set before slicing it; handing it one
 * server page would make the sort headers reorder 25 of 300 rows while looking
 * like they reordered all of them.
 *
 * `search` and `tags` still narrow server-side, so a search that matches little
 * finishes in one request.
 */
export async function listAll(params?: Omit<DashboardListParams, 'page' | 'pageSize'>) {
  return fetchAllPages((page, pageSize) =>
    list({ ...params, page, pageSize }) as Promise<RedashPaginatedResponse<MockDashboard>>
  )
}

/**
 * Every dashboard the caller owns, paged through. Same reason as queries: the
 * profile and the My tab render the whole set without pagination.
 */
export async function listAllMy() {
  return fetchAllPages((page, pageSize) =>
    listMy({ page, pageSize }) as Promise<RedashPaginatedResponse<MockDashboard>>
  )
}

export async function listAllFavorites() {
  return fetchAllPages((page, pageSize) =>
    listFavorites({ page, pageSize }) as Promise<RedashPaginatedResponse<MockDashboard>>
  )
}

export async function listFavorites(params?: DashboardListParams) {
  return normalizePage(
    await redashApi.get<RedashPaginatedResponse<RedashDashboard>>(
      'dashboards/favorites',
      { params: listParams(params) }
    )
  )
}

/**
 * Archived dashboards, which no other listing returns: `Dashboard.all` filters
 * `is_archived` out unconditionally, so before this endpoint existed archiving
 * a dashboard through the API put it beyond reach of every list.
 *
 * Mirrors `queries/archive`: same query parameters, same envelope.
 */
export async function listArchived(params?: DashboardListParams) {
  return normalizePage(
    await redashApi.get<RedashPaginatedResponse<RedashDashboard>>('dashboards/archive', {
      params: listParams(params),
    })
  )
}

/**
 * Every archived dashboard, not just the first page. Restoring is only
 * reachable from this list, so a single 25-row page would leave anything
 * archived before the most recent 25 with no way back.
 */
export async function listAllArchived() {
  return fetchAllPages((page, pageSize) =>
    listArchived({ page, pageSize }) as Promise<RedashPaginatedResponse<MockDashboard>>
  )
}

/**
 * Put an archived dashboard back. There is no dedicated endpoint, and none is
 * needed: `is_archived` is already in the field list `DashboardResource.post`
 * accepts, which is the same mechanism `queriesService.unarchive` uses.
 */
export async function unarchive(id: number): Promise<MockDashboard> {
  return update(id, { is_archived: false })
}

export async function get(id: number): Promise<MockDashboard | null> {
  try {
    return normalizeDashboard(await redashApi.get<RedashDashboard>(`dashboards/${id}`))
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
}

export async function create(data: { name: string; idempotency_key?: string }): Promise<MockDashboard> {
  const raw = await redashApi.post<RedashDashboard>('dashboards', {
    name: data.name,
    ...(data.idempotency_key ? { idempotency_key: data.idempotency_key } : {}),
  })
  // DashboardListResource.post reads only the name and always creates a draft,
  // which the list shows to its owner alone, admins included. This client has
  // no publish control, so un-draft immediately, the same two-step
  // queries.create uses.
  return update(raw.id, { is_draft: false })
}

export async function update(
  id: number,
  changes: Partial<MockDashboard>,
  expectedUpdatedAt?: string
): Promise<MockDashboard> {
  // Widgets are managed through /api/widgets — never sent on dashboard update
  const rest = { ...changes }
  delete rest.widgets
  const body = expectedUpdatedAt === undefined ? rest : { ...rest, expected_updated_at: expectedUpdatedAt }
  return normalizeDashboard(
    await redashApi.post<RedashDashboard>(`dashboards/${id}`, body)
  )
}

/** Redash DELETE archives the dashboard. */
export async function archive(id: number): Promise<void> {
  await redashApi.delete(`dashboards/${id}`)
}

/**
 * `expiresAt` is an ISO 8601 instant or nothing. Nothing sends an empty body,
 * exactly as this call did before expiry existed, so a share with no expiry is
 * indistinguishable on the wire from one made by the old client.
 */
export async function share(
  id: number,
  expiresAt?: string | null
): Promise<{ public_url: string; api_key: string }> {
  return redashApi.post<{ public_url: string; api_key: string }>(
    `dashboards/${id}/share`,
    expiresAt ? { expires_at: expiresAt } : undefined
  )
}

export async function unshare(id: number): Promise<void> {
  await redashApi.delete(`dashboards/${id}/share`)
}

/** Public (unauthenticated) dashboard by share token. */
export async function getPublic(token: string): Promise<MockDashboard | null> {
  try {
    return normalizeDashboard(
      await redashApi.get<RedashDashboard>(`dashboards/public/${token}`)
    )
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
}
