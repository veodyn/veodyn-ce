// What the binding form sends, and everything it can refuse before it posts.
//
// Pure and split from feed-form.tsx, which is at the file-size limit. Keeping
// it pure is also what lets the per-standard rules be tested without rendering:
// the two standards disagree about which half of the binding is required, and
// getting that wrong is a 422 at best and a destroyed field at worst.
import { fieldsFor, systemFieldsFor } from '@/lib/gbfs-fields'
import { missingRequired, toColumnMap } from '@/lib/gtfs-fields'
import type { FeedStandard, PublishedFeed, PublishedFeedInput } from '@/types/published-feed'

export interface FormValues {
  slug: string
  queryId: number
  standard: FeedStandard
  version: string
  entity: string
  staticGtfsRef: string
  systemInfo: Record<string, string>
  selection: Record<string, string | null>
  onError: PublishedFeedInput['onError']
  lastGoodMaxAgeSeconds: string
  visibility: PublishedFeedInput['visibility']
}

/** The system fields a gbfs binding is missing, empty for gtfs-rt. */
export function missingSystemFields(values: FormValues): string[] {
  if (values.standard !== 'gbfs') return []
  return systemFieldsFor(values.version).filter((field) => !values.systemInfo[field]?.trim())
}

/**
 * The one problem worth showing, or null. Ordered so the reader fixes the thing
 * furthest up the form first rather than being sent back and forth.
 */
export function submitError(values: FormValues): string | null {
  const missing = missingRequired(fieldsFor(values.standard), values.selection)
  if (missing.length > 0) {
    return `Map every required field before publishing: ${missing.join(', ')}.`
  }
  if (!values.slug.trim()) return 'Give this feed an address before publishing.'
  if (values.standard === 'gtfs-rt' && !values.staticGtfsRef.trim()) {
    return 'A static GTFS reference is required.'
  }
  const missingSystem = missingSystemFields(values)
  if (missingSystem.length > 0) {
    return `Fill in every system field before publishing: ${missingSystem.join(', ')}.`
  }
  return null
}

/**
 * The whole binding, shaped for the standard it names.
 *
 * Each standard carries exactly one of `staticGtfsRef` and `systemInfo` and
 * NULLS the other, because the API refuses a binding carrying both and the
 * database has a CHECK for each. `sourceColumn` is carried through rather than
 * re-sent as null: the endpoint is a whole-binding PUT, so a hardcoded null
 * here silently throws away a field this form offers no editor for.
 */
export function buildInput(values: FormValues, initial: PublishedFeed | undefined): PublishedFeedInput {
  const isGbfs = values.standard === 'gbfs'
  const systemInfo: Record<string, string> = {}
  if (isGbfs) {
    for (const field of systemFieldsFor(values.version)) {
      systemInfo[field] = values.systemInfo[field]?.trim() ?? ''
    }
  }

  return {
    slug: values.slug.trim(),
    queryId: values.queryId,
    standard: values.standard,
    version: values.version,
    entity: values.entity,
    staticGtfsRef: isGbfs ? null : values.staticGtfsRef.trim(),
    systemInfo: isGbfs ? systemInfo : null,
    sourceColumn: initial?.sourceColumn ?? null,
    columnMap: toColumnMap(fieldsFor(values.standard), values.selection),
    onError: values.onError,
    lastGoodMaxAgeSeconds:
      values.onError === 'last_good' ? Number(values.lastGoodMaxAgeSeconds) : null,
    visibility: values.visibility,
  }
}
