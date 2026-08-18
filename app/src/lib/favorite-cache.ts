/**
 * Flipping a star in whatever cache entry happens to be holding the object.
 * One object lives under several React Query keys (library list, Favorites tab,
 * my queries, the `/schedules` read, the detail entry), so an optimistic toggle
 * has to reach all of them.
 *
 * Shape-tolerant rather than typed to one response: the list envelopes differ
 * and the detail entry is the bare object. An unrecognised entry is returned
 * untouched.
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
 * the Zustand store holds, so a write through them would survive the rollback.
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
    // not re-render.
    return changed ? { ...data, results: next } : data
  }

  if (isFavoritable(data) && data.id === id) return { ...data, is_favorite: favorite }
  return data
}

/**
 * The sidecar's answer: starred ids grouped by object kind. An open map,
 * mirroring `FavoritesOut` (`RootModel[dict[str, list[str]]]`) in
 * api/veodyn_api/schemas/favorite.py. Keys are the singular kinds
 * src/features/favorite-kinds.ts derives.
 */
export type VeodynFavoriteIds = Record<string, string[]>

/**
 * The same flip for the sidecar's id lists: those objects carry no favorite
 * field of their own, and the Favorites page renders from these ids directly.
 */
export function withVeodynFavorite(
  data: VeodynFavoriteIds | undefined,
  kind: string,
  id: string,
  favorite: boolean
): VeodynFavoriteIds | undefined {
  if (!data) return data
  // Defaulted: the key may legitimately be absent when a build stars a kind the
  // cached read predates.
  const current = data[kind] ?? []
  const has = current.includes(id)
  if (has === favorite) return data
  return {
    ...data,
    [kind]: favorite ? [...current, id] : current.filter((entry) => entry !== id),
  }
}
