// The shapes the chat model may ask for, as this image can actually draw them.
//
// The API used to hold this list twice over, by hand: CHOICE_IDS and
// CHOICE_TYPE in services/ai_viz_choice.py, restated from lib/viz-choices.ts
// with a comment admitting the restatement ("this service cannot import
// TypeScript"). Two consequences followed, and the second is the one that hurt.
//
// A core shape added here and forgotten there just went unoffered. But a PACK
// visualization could never be offered at all: the API image does not install
// the pack (PACK_MANIFEST.json wires a Python half and a frontend half, and the
// sidecar is neither), so no hand-copy could have known the type existed. The
// model would name what it wanted, viz_choice() would fail to match it, and it
// would clamp to "table" with a log line nobody reads. A destination board
// arrived as a grid of latitudes.
//
// So the app tells the API instead, per turn. Only the app can: the registry is
// what the bundle really contains, and visualizations.enabled/audience is
// per-instance config the sidecar never sees.
//
// SERVER SIDE ONLY, and that is the point rather than an accident. The browser
// is not asked, so a client cannot name a type this image does not contain, nor
// one an operator has switched off. turnRequestSchema stays .strict(), which
// rejects a vizCatalog sent from outside; this one is added after that parse.
import '@/plugins'
import { config } from '@/lib/config'
import { visibleVizChoices } from '@/lib/viz-choices'

/** One shape, as the API's catalog-driven VIZ_RULES renders it. */
export interface VizCatalogEntry {
  id: string
  /** The Redash type the id produces, which the API needs to store a widget. */
  type: string
  label: string
  /** Absent when nobody wrote one; the API then lists the shape unexplained. */
  guide?: string
}

/**
 * Registration is per module graph and is installed from the entry of each
 * graph that needs it (see plugins/index.ts). This module is that entry for the
 * chat route's graph, which is why the bare `import '@/plugins'` above is not
 * dead: it is imported for its side effect.
 *
 * Safe on the server despite every pack renderer reaching for maplibre-gl,
 * because plugins register METADATA eagerly and lazy() their renderers and
 * editors. `defaultOptions`, `validate` and the choices below are all that is
 * read at registration time, and none of them touch the DOM.
 */
export function vizCatalog(): VizCatalogEntry[] {
  return visibleVizChoices(config.visualizations).map((choice) => ({
    id: choice.id,
    type: choice.type,
    label: choice.label,
    ...(choice.guide ? { guide: choice.guide } : {}),
  }))
}
