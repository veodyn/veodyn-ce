'use client'

import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useToast } from '@/components/shared/toast-provider'

/**
 * Persist a tag array, showing the result before the server has agreed to it and
 * putting the old one back when it refuses.
 *
 * The update mutations behind queries and dashboards invalidate on success and do
 * nothing on failure, so without this a refused write reads as an accepted one
 * until the next reload. `write` is passed rather than a mutation object because
 * each entity has its own update hook with its own payload shape.
 *
 * The cached object is read as a bag of unknown fields, since the hook is shared
 * by queries and dashboards and cares about one key. The spread is a runtime copy,
 * so every other field survives whatever the static type here says.
 */
export function useOptimisticTags(
  queryKey: QueryKey,
  write: (tags: string[], options: { onError: () => void }) => void
): (tags: string[]) => void {
  const qc = useQueryClient()
  const toast = useToast()

  return (tags: string[]) => {
    const previous = qc.getQueryData<Record<string, unknown>>(queryKey)
    if (previous) qc.setQueryData(queryKey, { ...previous, tags })
    write(tags, {
      onError: () => {
        // Two steps, because neither is sufficient alone. The snapshot goes back
        // first, but `previous` is only server truth when this was the only write
        // in flight: click add twice quickly and the second call snapshots the
        // first one's OPTIMISTIC array. The invalidation is what settles that.
        if (previous) qc.setQueryData(queryKey, previous)
        qc.invalidateQueries({ queryKey })
        toast.error('Could not save those tags.')
      },
    })
  }
}
