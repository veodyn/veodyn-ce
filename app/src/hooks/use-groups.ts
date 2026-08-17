'use client'

/**
 * Every group in the org, for surfaces that have to show a group by NAME
 * rather than by the id a foreign key stores.
 *
 * Distinct from `useProfileGroups`, which answers "which groups am I in" and
 * filters the mock store by membership for that reason. This one answers
 * "which groups exist", which is what a picker needs: an admin choosing who
 * may write to a dataset is choosing among all of them, not among their own.
 *
 * The backend does that narrowing itself and needs no argument for it.
 * `GroupListResource.get` (node/redash/handlers/groups.py) returns every group
 * in the org to an admin and only the caller's own to anyone else, so the same
 * request is correct for both and this hook does not have to know which it is
 * talking to.
 */

import { useQuery } from '@tanstack/react-query'
import { redashApi } from '@/services/api-client'
import { USE_REAL_API } from '@/services/redash/config'
import { useMockDataStore } from '@/stores/mock-data-store'

/**
 * The three fields a name lookup needs. `Group.to_dict` also sends
 * `permissions` and `created_at`; they are dropped here rather than carried,
 * so a consumer of this hook cannot start depending on a group's permissions
 * through a door meant for its name.
 */
export interface Group {
  id: number
  name: string
  type: string
}

export function useGroups() {
  const store = useMockDataStore()
  return useQuery({
    queryKey: ['groups'],
    queryFn: async (): Promise<Group[]> => {
      if (USE_REAL_API) {
        const groups = await redashApi.get<Group[]>('groups')
        return groups.map(({ id, name, type }) => ({ id, name, type }))
      }
      return store.groups.map(({ id, name, type }) => ({ id, name, type }))
    },
  })
}

/**
 * Group ids rendered as names, in the order given.
 *
 * An id with no matching group still renders, as `#<id>`, rather than being
 * dropped or shown as "Unknown". A writer group can be deleted while a dataset
 * still references it, and in that case the id is the only true thing left to
 * say: hiding it would make a dataset look like it had fewer writers than its
 * record claims, and "Unknown" would lose the one detail an admin needs to fix
 * it.
 */
export function groupNames(ids: number[], groups: Group[] | undefined): string[] {
  const byId = new Map((groups ?? []).map((group) => [group.id, group.name]))
  return ids.map((id) => byId.get(id) ?? `#${id}`)
}
