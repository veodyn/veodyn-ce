// The registry seam for favorites: which object kinds this build can star,
// and what each one is called.
//
// There is exactly one spelling per kind and the descriptor decides it. Before
// this module the app carried two, a singular one on the wire (`kpi`) and a
// plural one in its own state (`kpis`), with a lookup table in
// src/hooks/use-favorites.ts translating at each crossing. The table was a
// literal, in a community file, so a third kind could not arrive without
// editing it, and could arrive spelled either way.
//
// **The singular kind wins, and that is not a coin toss.** It is the only one
// of the two fixed by something this tree does not own: veodyn-api registers a
// favoritable kind as `registry.ObjectType.kind`, serves
// `POST /favorites/{kind}/{id}`, and answers GET /favorites with
// `RootModel[dict[str, list[str]]]`, one key per registered kind (see
// api/veodyn_api/registry.py and schemas/favorite.py). The plural is our own
// route and directory naming. So the wire vocabulary is the vocabulary, and
// `searchType.type` is where a descriptor already writes it down.
//
// The consequence to know: a kind is a `string` here, exactly as
// `searchType.type` and `ProposalContribution.kind` are, so the union that used
// to make `type="kpsi"` a compile error is gone. It could not survive: a
// literal union IS the literal list this seam exists to remove. What replaces
// it is `favoritableKinds()` below, which a caller can test membership
// against, and features/favorite-kinds.test.tsx, which pins the round trip
// through the real registry.
//
// Not re-exported from src/features/index.ts, for the reason search-sources.ts
// and slots.tsx give: that entry point is on the server root layout's
// pre-paint path.
import { FEATURES } from './generated-registry'
import { featureList } from './index'
import type { FeatureDescriptor } from './types'

/**
 * The two kinds Redash owns the stars on.
 *
 * Written out rather than derived, because no descriptor owns them and none
 * should: queries and dashboards are in every build, their favorites live on a
 * different backend (`/api/queries/<id>/favorite`), and their plural spelling
 * is Redash's own. Same shape as `STARRABLE` on the Favorites page, which seeds
 * these two and derives the rest.
 */
export const REDASH_FAVORITE_TYPES = ['queries', 'dashboards'] as const

export type RedashFavoriteType = (typeof REDASH_FAVORITE_TYPES)[number]

/** Whether Redash or the sidecar owns this object kind's stars. */
export function isRedashFavoriteType(type: string): type is RedashFavoriteType {
  return (REDASH_FAVORITE_TYPES as readonly string[]).includes(type)
}

/**
 * The kinds veodyn-api stores stars for in THIS build, in featureList() order.
 *
 * Filling `favorites.section` is the signal, and it is the same one the
 * Favorites page's empty state derives its links from: a feature that
 * contributes a section is exactly a feature whose objects can be starred and
 * collected there. A feature that fills the section without declaring a
 * `searchType` has no name to address its objects by and is dropped rather than
 * given an invented one; features/favorite-kinds.test.tsx fails on that
 * packaging mistake so it cannot ship silently.
 *
 * Takes the registry as an optional final parameter, the same way featureList
 * and assembleSearchSources do, so a caller can exercise the real
 * empty-registry path without mocking this module.
 */
export function favoritableKinds(
  registry: Record<string, FeatureDescriptor> = FEATURES
): string[] {
  return featureList(registry)
    .filter((feature) => feature.slots?.['favorites.section'] !== undefined)
    .map((feature) => feature.searchType?.type)
    .filter((kind): kind is string => kind !== undefined)
}
