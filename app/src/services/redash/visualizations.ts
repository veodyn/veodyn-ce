/**
 * Visualization CRUD against the real Redash backend.
 * Updates are POST (not PUT) to /api/visualizations/:id.
 * This app already stores Redash-native types (TABLE, CHART + options),
 * so options pass through without translation.
 */

import { redashApi } from '@/services/api-client'
import {
  normalizePublicVisualization,
  type PublicVisualizationPayload,
} from '@/lib/public-visualization'
import type { RedashVisualization } from './types'

/**
 * Read a shared visualization by its token, for the anonymous embed page.
 *
 * Deliberately NOT through `redashApi`: that client sends cookies and adds the
 * caller's key, and this request is made by a reader who has neither. It goes
 * to this app's own public route, which forwards to Redash without credentials.
 *
 * `null` means the link is dead, in every sense the reader is entitled to know:
 * unknown, revoked, expired, or a query that no longer answers.
 */
export async function fetchPublicVisualization(
  token: string,
  opts: { signal?: AbortSignal } = {}
): Promise<PublicVisualizationPayload | null> {
  const response = await fetch(`/api/public/visualizations/${encodeURIComponent(token)}`, {
    credentials: 'omit',
    signal: opts.signal,
    headers: { accept: 'application/json' },
  })
  if (!response.ok) return null
  return normalizePublicVisualization(await response.json())
}

export function createVisualization(data: {
  query_id: number
  type: string
  name: string
  description?: string
  options: Record<string, unknown>
}): Promise<RedashVisualization> {
  return redashApi.post<RedashVisualization>('visualizations', data)
}

export function updateVisualization(
  id: number,
  changes: {
    type?: string
    name?: string
    description?: string
    options?: Record<string, unknown>
  }
): Promise<RedashVisualization> {
  return redashApi.post<RedashVisualization>(`visualizations/${id}`, changes)
}

export async function deleteVisualization(id: number): Promise<void> {
  await redashApi.delete(`visualizations/${id}`)
}

/**
 * Mint a per-visualization share token, the embed twin of `dashboards.share`.
 *
 * The response mirrors that resource, and `api_key` is the part this app uses:
 * `public_url` points at the Redash origin, while the URL a reader should be
 * given is this product's own /embed/public/<token>.
 *
 * `expiresAt` is an ISO 8601 instant or nothing at all. Nothing means no
 * expiry, which is what every link minted before this existed has.
 */
export function shareVisualization(
  id: number,
  expiresAt?: string | null
): Promise<{ public_url: string; api_key: string }> {
  return redashApi.post<{ public_url: string; api_key: string }>(
    `visualizations/${id}/share`,
    expiresAt ? { expires_at: expiresAt } : {}
  )
}

export async function unshareVisualization(id: number): Promise<void> {
  await redashApi.delete(`visualizations/${id}/share`)
}
