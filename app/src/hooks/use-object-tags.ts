'use client'

// Writing tags for the three kinds veodyn-api owns: KPIs, reports and datasets.
//
// Queries and dashboards are not here. Redash stays authoritative for those, so
// they save through their own update calls (`useUpdateQuery`,
// `updateDashboard`) rather than through the tag service.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/components/shared/toast-provider'
import { isBackendUnconfigured } from '@/lib/backend-fallback'
import { isAppError } from '@/lib/errorIds'
import * as tagsService from '@/services/tags/client'
import { TagErrorCause, tagErrorCause, type TaggableObjectType } from '@/services/tags/client'

/** All this hook needs of a cached object: the array it is replacing. */
interface Tagged {
  tags: string[]
}

// The detail entry the optimistic write patches, and the list entry it
// invalidates, per kind. Kept here rather than passed in by each page, so the
// three callers cannot disagree about which cache entry holds an object.
const DETAIL_KEY: Record<TaggableObjectType, (id: string) => readonly unknown[]> = {
  kpi: (id) => ['kpi', id],
  report: (id) => ['report', id],
  dataset: (id) => ['catalog', id],
}

const LIST_KEY: Record<TaggableObjectType, readonly unknown[]> = {
  kpi: ['kpis'],
  report: ['reports'],
  dataset: ['catalog'],
}

const RESERVED_PREFIX_MESSAGE =
  'Tags starting with "domain:" are managed by the domain pages and cannot be set here.'

// The caps are veodyn-api's (`services/tag_rules.py`), and they are bounds on
// the body rather than product rules. Named here anyway, and named separately:
// "invalid" with no number leaves a person shortening a tag by guesswork, and
// the two caps have different remediations.
const TAG_TOO_LONG_MESSAGE = 'A tag can be at most 100 characters, so that one was not saved.'

const TOO_MANY_TAGS_MESSAGE =
  'An object can carry at most 50 tags. Remove one before adding another.'

const REPORT_LOCKED_MESSAGE =
  'Editing is locked while this report is in review, so its tags were not saved.'

/**
 * Named causes rather than one generic failure. A report that is in review is
 * edit-locked, which is a state the reader can act on ("come back after the
 * review"), and "Could not save those tags" would hide that.
 *
 * The backend's named cause is read BEFORE the status, because the status on
 * its own does not identify the failure: veodyn-api answers 422 for a reserved
 * `domain:` prefix, for a tag over the length cap, for a set over the count cap
 * and for a body it could not read. Reading 422 as "reserved prefix" tells a
 * person who typed a long tag to go and fix a prefix they never used.
 *
 * An unrecognized cause falls through to the status ladder and then to the
 * generic message, so a cause this frontend has not heard of yet degrades to
 * vague rather than to wrong. That is also what a version skew looks like: the
 * backend naming a cause this build predates costs a precise message, nothing
 * more.
 */
function writeFailureMessage(objectType: TaggableObjectType, error: unknown): string {
  const cause = tagErrorCause(error)
  if (cause === TagErrorCause.RESERVED_PREFIX) return RESERVED_PREFIX_MESSAGE
  if (cause === TagErrorCause.TAG_TOO_LONG) return TAG_TOO_LONG_MESSAGE
  if (cause === TagErrorCause.TOO_MANY_TAGS) return TOO_MANY_TAGS_MESSAGE
  if (cause === TagErrorCause.REPORT_EDIT_LOCKED) return REPORT_LOCKED_MESSAGE

  const status = isAppError(error) ? error.context.status : undefined
  if (status === 409) {
    return objectType === 'report'
      ? REPORT_LOCKED_MESSAGE
      : 'Something else changed these tags first. Reload the page and try again.'
  }
  if (status === 403) return 'You do not have permission to change these tags.'
  if (status === 404) return 'This object no longer exists, so its tags were not saved.'
  if (status === 503) return 'Tagging is not configured on this server.'
  return 'Could not save those tags.'
}

/**
 * Whether the tag backend is wired up at all.
 *
 * The proxy answers 503 while no veodyn-api base is configured, which is this
 * repo's agreed "not wired yet" signal. On that, a page hides the editing
 * affordance instead of offering a control whose every write fails. Anything
 * else counts as available: a 500 or a dropped connection is a backend that
 * exists and is having a bad minute, and making the Add Tag button come and go
 * with it would be worse than one failed write with a toast on it.
 *
 * Its own query key, cached forever, so the probe runs once per session no
 * matter how many detail pages are visited.
 */
export function useTagBackendAvailable(): boolean {
  const { data } = useQuery({
    queryKey: ['tag-backend-available'],
    staleTime: Infinity,
    queryFn: async ({ signal }) => {
      try {
        await tagsService.fetchTagVocabulary({ signal })
        return true
      } catch (error) {
        return !isBackendUnconfigured(error)
      }
    },
  })
  // Undefined until the probe answers, and unknown is treated as unavailable:
  // the control appears once tagging is known to work, rather than appearing
  // and then being taken away.
  return data === true
}

/**
 * Save the whole tag set for one object, optimistically.
 *
 * The array arrives whole from `TagsControl`, `domain:*` included, so a write
 * built from it cannot drop a domain hub. The cache entry is patched before the
 * request goes out and restored if it fails: without that the chip lands a
 * round trip after the click, and a refused write reads as an accepted one
 * until the page is reloaded.
 */
export function useObjectTags(objectType: TaggableObjectType, objectId: string) {
  const qc = useQueryClient()
  const toast = useToast()
  const detailKey = DETAIL_KEY[objectType](objectId)

  const mutation = useMutation({
    mutationFn: (tags: string[]) => tagsService.putObjectTags(objectType, objectId, tags),

    onMutate: async (tags: string[]) => {
      // A detail GET that started before this write would otherwise land after
      // it and put pre-write data back, so the chip that was just saved
      // disappears until something else refetches. Cancel first, then write.
      await qc.cancelQueries({ queryKey: detailKey })
      const previous = qc.getQueryData<Tagged>(detailKey)
      if (previous) qc.setQueryData(detailKey, { ...previous, tags })
      return { previous }
    },

    onSuccess: (stored) => {
      // What the backend kept, not what was sent: normalization and the
      // reserved-prefix rule run server side as well, so the two can differ.
      const current = qc.getQueryData<Tagged>(detailKey)
      if (current) qc.setQueryData(detailKey, { ...current, tags: stored })
      // Both keys. The detail entry has just been hand-patched from a mutation
      // response, which is not the same thing as having been read from the
      // server, and `exact` keeps the list invalidation off the dataset detail
      // entry (LIST_KEY.dataset is a prefix of DETAIL_KEY.dataset).
      qc.invalidateQueries({ queryKey: detailKey })
      qc.invalidateQueries({ queryKey: LIST_KEY[objectType], exact: true })
    },

    onError: (error, _tags, context) => {
      // Two steps, because neither is sufficient alone. The snapshot goes back
      // first so the refused tag leaves the screen immediately. But the
      // snapshot is only trustworthy when this was the only write in flight:
      // with two overlapping writes the second one snapshotted the first one's
      // optimistic array, so restoring it would leave a tag on screen that no
      // backend ever stored. The invalidation is what settles it, by making the
      // cache converge on what the server actually has.
      if (context?.previous) qc.setQueryData(detailKey, context.previous)
      qc.invalidateQueries({ queryKey: detailKey })
      toast.error(writeFailureMessage(objectType, error))
    },
  })

  // Deliberately not `async`: this is handed straight to `TagsControl.onChange`,
  // which is typed `(tags: string[]) => void`, and returning a promise there
  // trips @typescript-eslint/no-misused-promises. `mutate` (not `mutateAsync`)
  // reports through the callbacks above, so there is no promise to hand back.
  const saveTags = (tags: string[]) => {
    mutation.mutate(tags)
  }

  return { saveTags, isSaving: mutation.isPending }
}
