'use client'

// One star, two backends. Queries and dashboards are Redash objects and Redash
// owns their favorites; everything else starrable is stored by veodyn-api. The
// split lives here, so callers pass the object kind and get the same toggle
// either way.
//
// Which kinds the sidecar owns is not listed in this file: the descriptor
// supplies one spelling per kind. See src/features/favorite-kinds.ts.
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { favoritableKinds, isRedashFavoriteType, type RedashFavoriteType } from '@/features/favorite-kinds'
import { useMockDataStore } from '@/stores/mock-data-store'
import { useToast } from '@/components/shared/toast-provider'
import { withFixtureFallback, isBackendUnconfigured } from '@/lib/backend-fallback'
import { withFavorite, withVeodynFavorite, type VeodynFavoriteIds } from '@/lib/favorite-cache'
import { USE_REAL_API } from '@/services/redash/config'
import { setFavorite } from '@/services/redash/favorites'
import * as veodynFavorites from '@/services/favorites/client'

/**
 * A starrable object kind: one of Redash's two, or a kind an installed feature
 * contributes.
 *
 * `string` rather than a union: no union can be derived from `searchType.type`,
 * which is a `string` on the descriptor. What takes over from the compiler is
 * `isRedashFavoriteType` below, which routes on a membership test, and
 * features/favorite-kinds.test.tsx, which round-trips a star for every kind in
 * the real registry.
 */
export type FavoriteType = string

// Where a Redash object of each kind is cached. The list entry is a PREFIX: one
// query is held under several keys at once (library page, Favorites tab, "my
// queries", the whole-library read /schedules uses), and an optimistic star has
// to reach every one of them.
const REDASH_CACHE: Record<
  RedashFavoriteType,
  { listPrefix: QueryKey; detail: (id: number) => QueryKey }
> = {
  queries: { listPrefix: ['queries'], detail: (id) => ['query', id] },
  dashboards: { listPrefix: ['dashboards'], detail: (id) => ['dashboard', id] },
}

export const FAVORITES_KEY = ['veodyn-favorites'] as const

/**
 * The caller's starred ids, by object kind.
 *
 * A set per kind rather than a flag per row: those lists come from a different
 * endpoint, and asking each row would be one request per row.
 */
export function useVeodynFavorites() {
  useMockDataStore((s) => s.favorites)
  // getState rather than the subscribed snapshot, for the reason use-kpis gives:
  // a toggle invalidates this query at once and the refetch can run before React
  // re-renders, so a captured array would serve the pre-toggle value back into a
  // query that is then fresh. A list per installed kind, present even when empty,
  // as the real endpoint holds it: callers tell "nothing starred" from "no such
  // kind here" by reading the key.
  const fixture = () => {
    const stored = useMockDataStore.getState().favorites.sidecar
    const seeded: VeodynFavoriteIds = {}
    for (const kind of favoritableKinds()) seeded[kind] = [...(stored[kind] ?? [])]
    return seeded
  }
  return useQuery({
    queryKey: FAVORITES_KEY,
    // The sidecar is configured separately from Redash (KPI_API_URL), so
    // USE_REAL_API alone is not enough: a real Redash with no sidecar degrades
    // to fixtures like every other contributed surface.
    queryFn: async ({ signal }) =>
      USE_REAL_API
        ? withFixtureFallback(() => veodynFavorites.fetchFavorites({ signal }), fixture)
        : fixture(),
  })
}

interface ToggleVars {
  type: FavoriteType
  /** A Redash id is a number; a contributed object's id is its slug. */
  id: number | string
  /** Target state, required in real mode (POST adds, DELETE removes) */
  favorite?: boolean
}

/**
 * Star or unstar an object, showing the result before the server agrees to it.
 *
 * Invalidating on success alone left the star unchanged for the round trip and
 * the refetch behind it, measured at over five seconds on a real instance, and
 * the natural response (clicking again) is a toggle that undoes the write the
 * first click was still making. Same cache dance as `useObjectTags`.
 */
export function useToggleFavorite() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  const toast = useToast()
  return useMutation({
    mutationFn: async ({ type, id, favorite }: ToggleVars) => {
      if (!isRedashFavoriteType(type)) {
        if (USE_REAL_API) {
          if (favorite === undefined) {
            throw new Error('favorite target state is required with a real backend')
          }
          try {
            return await veodynFavorites.setFavorite(type, String(id), favorite)
          } catch (error) {
            // Same 503 contract the read falls back on: with no sidecar wired
            // up, a star writes to the fixture store so the control still
            // works. Any other failure is a real one and surfaces.
            if (!isBackendUnconfigured(error)) throw error
          }
        }
        store.toggleVeodynFavorite(type, String(id))
        return
      }

      if (USE_REAL_API) {
        if (favorite === undefined) {
          throw new Error('favorite target state is required with a real backend')
        }
        return setFavorite(type, Number(id), favorite)
      }
      store.toggleFavorite(type, Number(id))
    },

    onMutate: async ({ type, id, favorite }: ToggleVars) => {
      // Only a stated target can be shown early. `favorite` is optional for the
      // mock-mode callers that toggle whatever is there, and guessing the other
      // side of a state this hook cannot see is how an optimistic update lies.
      if (favorite === undefined) return { restore: () => {} }

      if (!isRedashFavoriteType(type)) {
        // Cancel first, then write: a read already in flight would otherwise
        // land after this and put the pre-click answer back.
        await qc.cancelQueries({ queryKey: FAVORITES_KEY })
        const previous = qc.getQueryData<VeodynFavoriteIds>(FAVORITES_KEY)
        qc.setQueryData<VeodynFavoriteIds | undefined>(FAVORITES_KEY, (current) =>
          withVeodynFavorite(current, type, String(id), favorite)
        )
        return {
          restore: () => {
            if (previous) qc.setQueryData(FAVORITES_KEY, previous)
          },
        }
      }

      const { listPrefix, detail } = REDASH_CACHE[type]
      const numericId = Number(id)
      await Promise.all([
        qc.cancelQueries({ queryKey: listPrefix }),
        qc.cancelQueries({ queryKey: detail(numericId) }),
      ])
      // Snapshot every entry under the prefix, not just the one on screen: the
      // rollback has to put back exactly what each key held.
      const previousLists = qc.getQueriesData({ queryKey: listPrefix })
      const previousDetail = qc.getQueryData(detail(numericId))
      qc.setQueriesData({ queryKey: listPrefix }, (data: unknown) =>
        withFavorite(data, numericId, favorite)
      )
      qc.setQueryData(detail(numericId), (data: unknown) =>
        withFavorite(data, numericId, favorite)
      )
      return {
        restore: () => {
          for (const [key, data] of previousLists) qc.setQueryData(key, data)
          if (previousDetail !== undefined) qc.setQueryData(detail(numericId), previousDetail)
        },
      }
    },

    onError: (_error, vars, context) => {
      // Two steps, for the reason useObjectTags gives: the snapshot goes back
      // first, and the invalidation settles the case where two toggles
      // overlapped and the second snapshotted the first one's optimistic value.
      context?.restore()
      invalidateFavorite(qc, vars)
      toast.error(
        vars.favorite
          ? 'Could not add that to your favorites.'
          : 'Could not remove that from your favorites.'
      )
    },

    onSuccess: (_data, vars) => invalidateFavorite(qc, vars),
  })
}

/**
 * Bring every cached view of this object back in line with the server. Shared by
 * the success and failure paths: the optimistic patch was a guess either way.
 */
function invalidateFavorite(qc: ReturnType<typeof useQueryClient>, vars: ToggleVars) {
  if (!isRedashFavoriteType(vars.type)) {
    // One key holds every contributed kind, and those lists carry no favorite
    // flag of their own to go stale, so this is the only thing to refresh.
    qc.invalidateQueries({ queryKey: FAVORITES_KEY })
    return
  }
  qc.invalidateQueries({ queryKey: ['queries'] })
  qc.invalidateQueries({ queryKey: ['dashboards'] })
  qc.invalidateQueries({
    queryKey: [vars.type === 'queries' ? 'query' : 'dashboard', vars.id],
  })
}
