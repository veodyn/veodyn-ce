// Filling the mock store's contributed collections, split out of
// mock-data-store.ts for file size and because it is a different concern: that
// file says what the store HOLDS, and this one says where the rows an installed
// feature owns come from.
//
// Takes the store as an argument rather than importing it, which keeps the
// dependency one-way (the store imports this, never the reverse) and lets the
// test drive it against a stub.
import { assembleMockData } from '@/features/mock-contributions'
import type { FeatureDescriptor } from '@/features/types'
import { USE_REAL_API } from '@/services/redash/config'

/** The two methods of a zustand store this needs, and nothing more. */
export interface HydratableStore<S extends object> {
  getState: () => S
  setState: (patch: Partial<S>) => void
}

/**
 * Put each installed feature's fixtures into the collections the store already
 * declares.
 *
 * Only keys the store ALREADY has as an array are applied. A contribution
 * naming anything else is data with no reader, and letting it through would put
 * a property on the state object that no type knows about. The store's own
 * declarations stay the authority on what a collection is; this only fills one.
 *
 * That is also what makes the empty case safe rather than merely tolerated: the
 * collection exists as `[]` before this runs and is still `[]` if nothing
 * contributes, so every reader sees an array either way. A seam that CREATED
 * the collections instead would leave `state.kpis` undefined in a build with no
 * KPI feature, which reads as "no KPIs" on one screen and throws on the next.
 *
 * Skipped outright when there is a real backend, for the reason packs/empty.ts
 * exists: no fixture is ever read in that build, so the loader is never entered
 * and the browser never fetches the chunk behind it.
 */
export function hydrateMockData<S extends object>(
  store: HydratableStore<S>,
  registry?: Record<string, FeatureDescriptor>
): Promise<void> {
  if (USE_REAL_API) return Promise.resolve()

  return assembleMockData(registry).then((contributed) => {
    const current = store.getState() as Record<string, unknown>
    const patch: Record<string, unknown[]> = {}
    for (const [collection, rows] of Object.entries(contributed)) {
      if (Array.isArray(current[collection])) patch[collection] = rows
    }
    store.setState(patch as Partial<S>)
  })
}

/**
 * Every collection the store holds, community and contributed alike.
 *
 * The read side of the rule above, and it lives here for the same reason: what
 * collections a build has is a property of which features are installed, and
 * nothing community can enumerate them by name. A caller that wants the rows of
 * a KIND it can describe structurally asks for all of them and narrows.
 *
 * The tag vocabulary is the case this exists for. It wants every row carrying a
 * `tags` array, and it used to get there by listing `queries, dashboards,
 * datasets, kpis, reports`, which put two enterprise collection names in a
 * community hook for no better reason than that they were the taggable ones on
 * the day it was written.
 *
 * `unknown[]`, because this module cannot name a contributed row's type. The
 * non-array state (favorites, accessGrants, queryResults, and every action) is
 * filtered out here rather than at each call site.
 *
 * Pass it through zustand's `useShallow` when selecting with it: the outer
 * array is fresh on every call, while each collection's identity only changes
 * when that collection does, so an element-wise compare re-renders exactly as
 * often as naming the collections one by one did.
 */
export function storeCollections(state: object): readonly unknown[][] {
  return Object.values(state).filter((value): value is unknown[] => Array.isArray(value))
}
