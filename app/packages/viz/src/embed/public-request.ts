import { normalizePublicVisualization, type PublicVisualizationPayload } from '../lib/public-visualization'

export type PublicParameters = Record<string, string | number>

export type PublicVisualizationResult = PublicVisualizationPayload & { retryAfterMs?: number }

export const MAX_PENDING_RETRIES = 10
export const FALLBACK_POLL_MS = 30_000
const DEFAULT_PENDING_RETRY_MS = 2000
const MIN_RETRY_AFTER_SECONDS = 1
const MAX_RETRY_AFTER_SECONDS = 30

export function canonicalParameters(parameters: PublicParameters | undefined): [string, string][] {
  return Object.entries(parameters ?? {})
    .map(([key, value]): [string, string] => [key, String(value)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
}

export function publicParameterSearch(parameters: PublicParameters | undefined): string {
  const pairs = canonicalParameters(parameters)
  if (pairs.length === 0) return ''
  return `?${pairs.map(([key, value]) => `${encodeURIComponent(`p_${key}`)}=${encodeURIComponent(value)}`).join('&')}`
}

export function parseRetryAfterMs(header: string | null): number | undefined {
  if (header === null || header.trim() === '') return undefined
  const seconds = Number(header)
  if (!Number.isFinite(seconds)) return undefined
  return Math.min(Math.max(seconds, MIN_RETRY_AFTER_SECONDS), MAX_RETRY_AFTER_SECONDS) * 1000
}

export async function readPublicResponse(response: Response): Promise<PublicVisualizationResult | null> {
  if (response.status === 404) return null
  const interim = response.status === 202 || response.status === 503
  if (!response.ok && !interim) throw new Error(`Shared visualization request failed with status ${response.status}`)

  const payload = normalizePublicVisualization(await response.json().catch(() => null))
  if (!interim) return payload
  if (!payload) throw new Error(`Shared visualization request failed with status ${response.status}`)
  const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'))
  return retryAfterMs === undefined ? payload : { ...payload, retryAfterMs }
}

export function pollIntervalMs(
  payload: Pick<PublicVisualizationResult, 'status' | 'retryAfterMs'> | null | undefined,
  pendingStreak: number,
  refreshMs: number | null
): number | false {
  if (payload?.status !== 'pending' && payload?.status !== 'unavailable') return refreshMs ?? false
  if (pendingStreak > MAX_PENDING_RETRIES) return Math.max(refreshMs ?? 0, FALLBACK_POLL_MS)
  return payload.retryAfterMs ?? DEFAULT_PENDING_RETRY_MS
}
