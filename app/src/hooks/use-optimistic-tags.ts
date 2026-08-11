'use client'

import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useToast } from '@/components/shared/toast-provider'

/**
 * Persist a tag array, showing the result before the server has agreed to it
 * and putting the old one back when it refuses.
 *
 * The update mutations behind queries and dashboards invalidate on success and
 * do nothing on failure. Without this the new chip would land a round trip
 * after the click, and a refused write would read as an accepted one until the
 * next reload, which is the worse of the two.
 *
 * `write` is passed rather than a mutation object because each entity already
 * has its own update hook with its own payload shape; this only owns the cache
 * dance and the message.
 *
 * The cached object is read as a bag of unknown fields on purpose: the hook is
 * shared by queries and dashboards and cares about exactly one key. The spread
 * is a runtime copy, so every other field survives whatever the static type
 * here says.
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
        // Two steps, because neither is sufficient alone. The snapshot goes
        // back first so the refused tag leaves the screen immediately, with no
        // wait for a round trip. But `previous` is only server truth when this
        // was the only write in flight: click add twice quickly and the second
        // call snapshots the first one's OPTIMISTIC array, so if both are
        // refused, restoring it leaves a tag on screen that was never stored.
        // The invalidation is what settles that, by making the cache converge
        // on whatever the server actually has.
        if (previous) qc.setQueryData(queryKey, previous)
        qc.invalidateQueries({ queryKey })
        toast.error('Could not save those tags.')
      },
    })
  }
}
