'use client'

// Writing tags for the three kinds veodyn-api owns: KPIs, reports and datasets.
// Redash stays authoritative for queries and dashboards, so those save through
// their own update calls (`useUpdateQuery`, `updateDashboard`) instead.

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
// invalidates, per kind. Kept here so the three callers cannot disagree about
// which cache entry holds an object.
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

// The caps are veodyn-api's (`services/tag_rules.py`). Named in the message
// because "invalid" with no number leaves a person shortening a tag by guesswork.
const TAG_TOO_LONG_MESSAGE = 'A tag can be at most 100 characters, so that one was not saved.'

const TOO_MANY_TAGS_MESSAGE =
  'An object can carry at most 50 tags. Remove one before adding another.'

const REPORT_LOCKED_MESSAGE =
  'Editing is locked while this report is in review, so its tags were not saved.'

/**
 * The backend's named cause is read BEFORE the status, because the status alone
 * does not identify the failure: veodyn-api answers 422 for a reserved `domain:`
 * prefix, for a tag over the length cap, for a set over the count cap and for a
 * body it could not read.
 *
 * An unrecognized cause falls through to the status ladder and then to the
 * generic message, so a cause this build predates degrades to vague, not wrong.
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
 * repo's "not wired yet" signal, and a page then hides the editing affordance.
 * Anything else counts as available: a 500 or a dropped connection is a backend
 * having a bad minute, not an absent one.
 *
 * Cached forever under its own key, so the probe runs once per session.
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
  // Undefined until the probe answers, and unknown counts as unavailable: the
  // control appears once tagging is known to work, rather than being taken away.
  return data === true
}

/**
 * Save the whole tag set for one object, optimistically.
 *
 * The array arrives whole from `TagsControl`, `domain:*` included, so a write
 * built from it cannot drop a domain hub. The cache entry is patched before the
 * request goes out and restored if it fails.
 */
export function useObjectTags(objectType: TaggableObjectType, objectId: string) {
  const qc = useQueryClient()
  const toast = useToast()
  const detailKey = DETAIL_KEY[objectType](objectId)

  const mutation = useMutation({
    mutationFn: (tags: string[]) => tagsService.putObjectTags(objectType, objectId, tags),

    onMutate: async (tags: string[]) => {
      // Cancel first, then write: a detail GET that started before this write
      // would otherwise land after it and put pre-write data back.
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
      // `exact` keeps the list invalidation off the dataset detail entry:
      // LIST_KEY.dataset is a prefix of DETAIL_KEY.dataset.
      qc.invalidateQueries({ queryKey: detailKey })
      qc.invalidateQueries({ queryKey: LIST_KEY[objectType], exact: true })
    },

    onError: (error, _tags, context) => {
      // Two steps, because neither is sufficient alone. The snapshot goes back
      // first, but it is only server truth when this was the only write in
      // flight: with two overlapping writes the second snapshotted the first
      // one's optimistic array. The invalidation is what settles that.
      if (context?.previous) qc.setQueryData(detailKey, context.previous)
      qc.invalidateQueries({ queryKey: detailKey })
      toast.error(writeFailureMessage(objectType, error))
    },
  })

  // Not `async`: this is handed to `TagsControl.onChange`, typed
  // `(tags: string[]) => void`, and returning a promise there trips
  // @typescript-eslint/no-misused-promises.
  const saveTags = (tags: string[]) => {
    mutation.mutate(tags)
  }

  return { saveTags, isSaving: mutation.isPending }
}
