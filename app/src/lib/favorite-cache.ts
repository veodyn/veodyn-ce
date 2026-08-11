/**
 * Flipping a star in whatever cache entry happens to be holding the object.
 *
 * A starred query is cached in several places at once: the library list, the
 * Favorites tab, the "my queries" list, the whole-library read `/schedules`
 * uses, and the detail entry. They are separate React Query keys with separate
 * data, so an optimistic toggle has to reach all of them or the star fills in
 * one place and stays empty in the next.
 *
 * Shape-tolerant on purpose rather than typed to one response. The lists differ
 * in their envelope (`{count, results}`, `{count, results, truncated}`) and the
 * detail entry is the bare object, and this is handed straight to
 * `setQueriesData`, which types its data as unknown anyway. An entry it does
 * not recognise is returned untouched, so a cache key that grows a new shape
 * later degrades to "not updated optimistically" rather than to a corrupted
 * entry.
 */

/** The one field Redash uses for this, on both queries and dashboards. */
interface Favoritable {
  id: number
  is_favorite?: boolean
}

function isFavoritable(value: unknown): value is Favoritable {
  return typeof value === 'object' && value !== null && typeof (value as Favoritable).id === 'number'
}

/**
 * `data` with the star flipped on the object with this id.
 *
 * Copies rather than mutates: in mock mode the cached rows are the very objects
 * the Zustand store holds, so writing through them would change the store
 * behind its own back and survive the rollback this exists to allow.
 */
export function withFavorite(data: unknown, id: number, favorite: boolean): unknown {
  if (!data || typeof data !== 'object') return data

  const results = (data as { results?: unknown }).results
  if (Array.isArray(results)) {
    let changed = false
    const next = results.map((row) => {
      if (!isFavoritable(row) || row.id !== id) return row
      changed = true
      return { ...row, is_favorite: favorite }
    })
    // The same reference back when nothing matched, so an untouched list does
    // not re-render every row that happens to be cached under this prefix.
    return changed ? { ...data, results: next } : data
  }

  if (isFavoritable(data) && data.id === id) return { ...data, is_favorite: favorite }
  return data
}

/**
 * The sidecar's answer: starred ids grouped by object kind.
 *
 * An open map and not two declared fields, because which kinds a build can
 * star is a property of which features are installed. It mirrors what the
 * service actually serves: `FavoritesOut` over there is
 * `RootModel[dict[str, list[str]]]`, one key per kind its own registry holds
 * (api/veodyn_api/schemas/favorite.py). The keys are the singular kinds
 * src/features/favorite-kinds.ts derives; nothing in this file names one.
 */
export type VeodynFavoriteIds = Record<string, string[]>

/**
 * The same flip for the sidecar's id lists.
 *
 * A set rather than a flag per row, because that is the shape the sidecar
 * serves: those objects carry no favorite field of their own, and the
 * Favorites page renders from these ids directly.
 */
export function withVeodynFavorite(
  data: VeodynFavoriteIds | undefined,
  kind: string,
  id: string,
  favorite: boolean
): VeodynFavoriteIds | undefined {
  if (!data) return data
  // Defaulted, because the key may legitimately be absent: a build can star a
  // kind the cached read predates, and an optimistic patch must add the list
  // rather than throw on the way to it.
  const current = data[kind] ?? []
  const has = current.includes(id)
  if (has === favorite) return data
  return {
    ...data,
    [kind]: favorite ? [...current, id] : current.filter((entry) => entry !== id),
  }
}
