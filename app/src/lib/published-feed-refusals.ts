import { isAppError } from '@/lib/errorIds'
import { GTFS_FIELDS } from '@/lib/gtfs-fields'

const BINDING_INVALID_PREFIX = 'the column map cannot produce this feed: '
const KNOWN_FIELDS = new Set(GTFS_FIELDS.map((f) => f.name))

/**
 * Splits a BINDING_INVALID message into per-field problems.
 *
 * The sidecar names every problem in one sentence, joined with '; ' (see
 * feed_binding_checks.py). Each problem is put on the mapping row whose GTFS
 * field name it quotes ("required field 'vehicle_id' is not mapped"); a
 * problem that quotes no known field name (a column name, an entity name)
 * falls back to the form-level error, since there is no row to attach it to.
 */
function splitBindingInvalid(message: string): { fieldErrors: Record<string, string>; formErrors: string[] } {
  const body = message.startsWith(BINDING_INVALID_PREFIX)
    ? message.slice(BINDING_INVALID_PREFIX.length)
    : message
  const fieldErrors: Record<string, string> = {}
  const formErrors: string[] = []
  for (const problem of body.split('; ')) {
    const quoted = [...problem.matchAll(/'([^']+)'/g)].map((m) => m[1])
    const field = quoted.find((name) => KNOWN_FIELDS.has(name))
    if (field) fieldErrors[field] = problem
    else formErrors.push(problem)
  }
  return { fieldErrors, formErrors }
}

export interface RefusalPlacement {
  /** Keyed by form field name, or by GTFS field name for a mapping row. */
  fieldErrors: Record<string, string>
  /** Only what no field could claim. Null leaves the form-level banner clear. */
  formError: string | null
  /** What to say in the toast, whichever way the refusal was placed. */
  message: string
}

/**
 * Where a refused save belongs on screen.
 *
 * Shared by the create page and the edit page rather than living on create
 * alone, because `update_feed` runs the same `_check` as `create_feed` and
 * answers with the same SLUG_TAKEN, QUERY_UNREADABLE and BINDING_INVALID
 * refusals. The spec's rule that "refusals render at the field that caused
 * them, never as a page banner" is about this resource, not about one of its
 * two write paths, and edit was holding only half of it.
 *
 * Anything unrecognised deliberately lands on the form. A pydantic 422 or a
 * transport failure names no field, and inventing one to attach it to would put
 * a red line under a value that is fine.
 */
export function placeRefusal(err: unknown, fallback: string): RefusalPlacement {
  const message = err instanceof Error ? err.message : fallback
  if (isAppError(err)) {
    const code = err.context.errorId
    if (code === 'VEODYN_PUBLISHED_FEED_SLUG_TAKEN') {
      return { fieldErrors: { slug: err.message }, formError: null, message }
    }
    if (code === 'VEODYN_PUBLISHED_FEED_QUERY_UNREADABLE') {
      return { fieldErrors: { query: err.message }, formError: null, message }
    }
    if (code === 'VEODYN_PUBLISHED_FEED_BINDING_INVALID') {
      const { fieldErrors, formErrors } = splitBindingInvalid(err.message)
      // Only the problems no row could claim go on the form: a problem already
      // sitting under its field would just repeat itself here.
      return { fieldErrors, formError: formErrors.length > 0 ? formErrors.join('; ') : null, message }
    }
  }
  return { fieldErrors: {}, formError: message, message }
}
