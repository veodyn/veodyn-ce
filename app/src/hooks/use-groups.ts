'use client'

/**
 * Every group in the org, for surfaces that have to show a group by NAME rather
 * than by the id a foreign key stores.
 *
 * Distinct from `useProfileGroups`, which answers "which groups am I in". This
 * one answers "which groups exist", which is what a picker needs.
 *
 * The backend narrows by caller itself: `GroupListResource.get`
 * (node/redash/handlers/groups.py) returns every group in the org to an admin and
 * only the caller's own to anyone else, so one request is correct for both.
 */

import { useQuery } from '@tanstack/react-query'
import { redashApi } from '@/services/api-client'
import { USE_REAL_API } from '@/services/redash/config'
import { useMockDataStore } from '@/stores/mock-data-store'

/**
 * The three fields a name lookup needs. `Group.to_dict` also sends `permissions`
 * and `created_at`, dropped here so a consumer of this hook cannot start
 * depending on a group's permissions through a door meant for its name.
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
 * An id with no matching group still renders, as `#<id>`: a writer group can be
 * deleted while a dataset still references it, and the id is then the only true
 * thing left to say. Dropping it would make the dataset look like it had fewer
 * writers than its record claims.
 */
export function groupNames(ids: number[], groups: Group[] | undefined): string[] {
  const byId = new Map((groups ?? []).map((group) => [group.id, group.name]))
  return ids.map((id) => byId.get(id) ?? `#${id}`)
}
