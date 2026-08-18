// Where the rows an installed feature owns get into the mock store.
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
 * Only keys the store ALREADY has as an array are applied: the store's own
 * declarations stay the authority on what a collection is, and this only fills
 * one. So every collection exists as `[]` before this runs and is still `[]` if
 * nothing contributes, and no reader ever sees undefined.
 *
 * Skipped outright when there is a real backend, so the loader is never entered
 * and the browser never fetches the chunk behind it (see packs/empty.ts).
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
 * Which collections a build has is a property of which features are installed, so
 * nothing community can enumerate them by name: a caller wanting the rows of a
 * kind it can describe structurally asks for all of them and narrows. The tag
 * vocabulary, which wants every row carrying a `tags` array, is that caller.
 * `unknown[]`, because this module cannot name a contributed row's type; the
 * non-array state (favorites, accessGrants, queryResults, every action) is
 * filtered out here rather than at each call site.
 *
 * Pass it through zustand's `useShallow` when selecting with it: the outer array
 * is fresh on every call, while each collection's identity only changes when that
 * collection does.
 */
export function storeCollections(state: object): readonly unknown[][] {
  return Object.values(state).filter((value): value is unknown[] => Array.isArray(value))
}
