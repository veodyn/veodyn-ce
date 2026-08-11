// Favorites for the object kinds veodyn-api owns.
//
// Which kinds those are is not written down here. They come from the feature
// registry (src/features/favorite-kinds.ts), which is the same fact the service
// resolves them from on its side: `registry.favoritable_kinds()` there, the
// installed feature descriptors here.
//
// Redash's own favorites (queries, dashboards) live in services/redash and go
// through a different backend entirely. Same star on screen, two owners behind
// it, which is why the hook rather than the component decides where a toggle
// goes.
import { favoritableKinds } from '@/features/favorite-kinds'
import { AppError, ErrorIds, isAppError } from '@/lib/errorIds'

/**
 * The wire shape of GET /api/favorites: the caller's own ids, by kind.
 *
 * One entry per kind the service registered, which is why this is an open map
 * rather than a field per kind: `FavoritesOut` on the other side is
 * `RootModel[dict[str, list[str]]]` and grows a key when a pack registers a
 * fourth favoritable kind, with no schema change there and none needed here.
 */
export type VeodynFavorites = Record<string, string[]>

function wrapError(error: unknown): Error {
  if (isAppError(error)) return error
  if (error instanceof Error && error.name === 'AbortError') return error
  return new AppError(ErrorIds.FAVORITES_REQUEST_FAILED, 'favorites request failed', {
    cause: error instanceof Error ? error.message : String(error),
  })
}

export async function fetchFavorites(
  opts: { signal?: AbortSignal } = {}
): Promise<VeodynFavorites> {
  try {
    const res = await fetch('/api/favorites', { credentials: 'include', signal: opts.signal })
    if (!res.ok) {
      throw new AppError(ErrorIds.FAVORITES_REQUEST_FAILED, `favorites fetch failed (${res.status})`, {
        status: res.status,
      })
    }
    const body = (await res.json()) as Record<string, unknown>
    // Seeded with a list per kind this build knows about, then filled from the
    // body. Defaulted rather than trusted, for the reason it always was: a
    // backend that answers without one of the lists must not turn every row on
    // that page into "not favorited" by way of a crash in the caller.
    //
    // A key the body carries and this build does not know is kept rather than
    // dropped. The service's registry is the authority on what exists, and a
    // browser running one deploy behind a pack that added a kind should hold
    // the ids rather than quietly discard somebody's stars.
    const favorites: VeodynFavorites = {}
    for (const kind of favoritableKinds()) favorites[kind] = []
    for (const [kind, ids] of Object.entries(body)) {
      if (Array.isArray(ids)) favorites[kind] = ids.filter((id): id is string => typeof id === 'string')
    }
    return favorites
  } catch (error) {
    throw wrapError(error)
  }
}

export async function setFavorite(
  /** The object kind, spelled as its descriptor's `searchType.type` spells it. */
  type: string,
  id: string,
  favorite: boolean,
  opts: { signal?: AbortSignal } = {}
): Promise<void> {
  try {
    const res = await fetch(`/api/favorites/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, {
      method: favorite ? 'POST' : 'DELETE',
      credentials: 'include',
      signal: opts.signal,
    })
    if (!res.ok) {
      throw new AppError(ErrorIds.FAVORITES_REQUEST_FAILED, `favorite write failed (${res.status})`, {
        status: res.status,
        type,
        id,
      })
    }
  } catch (error) {
    throw wrapError(error)
  }
}
