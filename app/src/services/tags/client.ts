// Tag client for the kinds veodyn-api owns (KPIs, reports, datasets) plus the
// two vocabulary endpoints Redash owns. Everything goes through a same-origin
// path: /api/tags/* for the sidecar, /api/node/* for Redash.
//
// Query and dashboard tags are written through the Redash query/dashboard
// update calls, not here, because Redash stays authoritative for those.

import { AppError, ErrorIds, isAppError } from '@/lib/errorIds'
import type { TagSuggestion } from '@/lib/tags'

/** The object kinds the sidecar's tag_assignment table covers. */
export type TaggableObjectType = 'kpi' | 'report' | 'dataset'

/** Which Redash vocabulary endpoint to read. */
export type RedashTagScope = 'queries' | 'dashboards'

/**
 * The causes veodyn-api names on a refused tag write, from its own registry
 * (`veodyn_api/errors.py`). Carried through because the HTTP status does not
 * identify the cause on its own: a reserved `domain:` prefix and a tag over the
 * length cap are both 422, and telling someone who typed a long tag that the
 * prefix is reserved is a false remediation.
 */
export const TagErrorCause = {
  RESERVED_PREFIX: 'VEODYN_TAG_PREFIX_RESERVED',
  // The two size caps carry their own ids rather than sharing one. They have
  // different remediations (shorten this tag, versus remove one), and a single
  // "invalid" would put the caller back to guessing which bound they hit.
  TAG_TOO_LONG: 'VEODYN_TAG_TOO_LONG',
  TOO_MANY_TAGS: 'VEODYN_TOO_MANY_TAGS',
  // A body this endpoint could not read at all, e.g. `tags` not being a list.
  // Not a size violation: veodyn-api stopped answering the caps with this id.
  INVALID_REQUEST: 'VEODYN_INVALID_REQUEST',
  REPORT_EDIT_LOCKED: 'VEODYN_REPORT_EDIT_LOCKED',
} as const

/** The backend's named cause for a failed write, when it gave one. */
export function tagErrorCause(error: unknown): string | undefined {
  if (!isAppError(error)) return undefined
  const cause = error.context.errorId
  return typeof cause === 'string' ? cause : undefined
}

/**
 * veodyn-api answers every refusal with `{"error": {"id", "message"}}`. The
 * proxy's own 502 and 503 bodies put a plain string under the same key, and an
 * upstream that fell over may answer no JSON at all, so only an object carrying
 * a string `id` counts as a cause. Anything else leaves it undefined and the
 * caller falls back to a generic message.
 */
async function readErrorCause(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { error?: { id?: unknown } }
    const id = body?.error?.id
    return typeof id === 'string' ? id : undefined
  } catch {
    return undefined
  }
}

// Aborts pass through untouched: a cancellation is the caller's own doing, not
// a backend failure, and callers unwrap it by `name` (see catalog/client.ts for
// why `instanceof DOMException` is unreliable across jsdom and Node realms).
function wrapTagError(error: unknown, message: string): Error {
  if (isAppError(error)) return error
  if (error instanceof Error && error.name === 'AbortError') return error
  return new AppError(ErrorIds.API_UPSTREAM_FAILED, message, {
    cause: error instanceof Error ? error.message : String(error),
  })
}

/**
 * Both vocabularies are on the wire as either a bare array or `{tags: [...]}`:
 * Redash wraps, the sidecar does not. Read either rather than making the caller
 * know which backend answered.
 */
function readVocabulary(body: unknown): TagSuggestion[] {
  const raw = Array.isArray(body) ? body : (body as { tags?: unknown })?.tags
  if (!Array.isArray(raw)) return []
  return raw
    .filter((entry): entry is { name: string; count?: unknown } =>
      typeof (entry as { name?: unknown })?.name === 'string'
    )
    .map((entry) => ({
      name: entry.name,
      count: typeof entry.count === 'number' ? entry.count : 0,
    }))
}

async function getVocabulary(url: string, signal?: AbortSignal): Promise<TagSuggestion[]> {
  try {
    const res = await fetch(url, { credentials: 'include', signal })
    if (!res.ok) {
      throw new AppError(ErrorIds.API_UPSTREAM_FAILED, `tag vocabulary fetch failed (${res.status})`, {
        status: res.status,
        url,
      })
    }
    return readVocabulary(await res.json())
  } catch (error) {
    throw wrapTagError(error, 'tag vocabulary request failed')
  }
}

/** The sidecar's union across KPIs, reports and datasets. */
export function fetchTagVocabulary(
  opts: { signal?: AbortSignal } = {}
): Promise<TagSuggestion[]> {
  return getVocabulary('/api/tags', opts.signal)
}

/** Redash's own vocabulary for one of its two taggable kinds. */
export function fetchRedashTagVocabulary(
  scope: RedashTagScope,
  opts: { signal?: AbortSignal } = {}
): Promise<TagSuggestion[]> {
  return getVocabulary(`/api/node/${scope}/tags`, opts.signal)
}

/**
 * Replace the whole tag set for one object. Replace rather than add/remove
 * because `TagsControl.onChange` hands back the full array, which also makes
 * the call idempotent under retry.
 *
 * Returns what the backend actually stored, so the caller renders that rather
 * than what it sent: normalization and the reserved-prefix rule both run server
 * side as well.
 *
 * A refusal carries the backend's named cause alongside the status, so the
 * caller can tell a reserved prefix from a tag that broke a size cap. Both are
 * 422 and they need different remediations.
 */
export async function putObjectTags(
  objectType: TaggableObjectType,
  objectId: string,
  tags: string[],
  opts: { signal?: AbortSignal } = {}
): Promise<string[]> {
  const url = `/api/tags/${objectType}/${encodeURIComponent(objectId)}`
  try {
    const res = await fetch(url, {
      method: 'PUT',
      credentials: 'include',
      signal: opts.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tags }),
    })
    if (!res.ok) {
      throw new AppError(ErrorIds.API_UPSTREAM_FAILED, `tag write failed (${res.status})`, {
        status: res.status,
        errorId: await readErrorCause(res),
        objectType,
        objectId,
      })
    }
    const body = (await res.json()) as unknown
    const stored = Array.isArray(body) ? body : (body as { tags?: unknown })?.tags
    return Array.isArray(stored) ? stored.filter((t): t is string => typeof t === 'string') : []
  } catch (error) {
    throw wrapTagError(error, 'tag write request failed')
  }
}
