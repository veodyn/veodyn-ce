import type { ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { MockDashboard } from '@/lib/mock-data'
import type { SearchSource } from '@/services/search/types'
import type { FeatureProposal } from '@/types/ai-create'
import type { Dataset, HubCounter } from '@/types/catalog'

export type NavSectionId = 'library' | 'monitor' | 'admin'

export interface FeatureNavRow {
  label: string
  href: string
  icon: LucideIcon
  /**
   * Which sidebar section this row belongs to. This is the only gating
   * signal: the 'admin' section itself renders only for admins (see
   * buildSidebarSections in lib/sidebar-nav.ts), so a row placed there is
   * already admin-only with nothing else to say so.
   */
  section: NavSectionId
}

/**
 * A feature's identity in federated search: the label, the noun and the icon.
 * The code that fetches the results is a separate field, `searchSource`, so a
 * feature that is searchable but supplies no fetcher (or the reverse) is a
 * shape the type system allows and the assembler handles.
 */
export interface FeatureSearchType {
  type: string
  label: string
  noun: string
  icon: LucideIcon
}

/**
 * How a feature contributes results to federated search.
 *
 * A factory returning a promise, not a `SearchSource`, and that is the whole
 * point of the field. This module is reached from the server root layout
 * through src/lib/theme-preference.ts, so a descriptor that imported its
 * feature's client to build a `SearchSource` value would pull that client into
 * every route's pre-paint path. A loader is entered on the first search and
 * never before, and the descriptor stays inert data.
 *
 * Assembled by features/search-sources.ts, which is what federated search
 * reads instead of a hand-written array.
 */
export type SearchSourceFactory = () => Promise<SearchSource>

/**
 * A route this feature owns. A RegExp and not a prefix, because the rules
 * being replaced are exact: the print route is /^\/reports\/[^/]+\/print\/?$/
 * and a /reports/ prefix would match every report page.
 */
export interface FeatureRoute {
  pattern: RegExp
  /** Omit the app shell entirely, e.g. an unattended wall display. */
  bareChrome?: boolean
  forcedTheme?: 'light' | 'dark'
}

/**
 * A slot exactly one feature may fill, rendered with `<Slot>`.
 *
 * First contributor wins and the rest are ignored, which is what these
 * surfaces need: each one is a single place that either shows the community
 * answer or shows one feature's answer instead of it. Home's strip replaces
 * the whole section because a mover and a freshness card cannot be composed
 * (see components/kpi/home-notable-changes.tsx); a hub counter tile replaces
 * one tile in a grid the community component still owns; the AI digest, the
 * annotation suggester and the dashboard promote action each occupy one hole
 * that has one right occupant.
 *
 * Two features filling one of these is a packaging mistake, and `<Slot>`
 * renders the first rather than refusing to render the surface at all.
 */
export type SingleSlotId =
  | 'home.notableChanges'
  | 'home.aiDigest'
  | 'catalog.hubCounters'
  | 'dashboard.annotationSuggest'
  | 'dashboard.viewActions'
  | 'feedHealth.metrics'

/**
 * A slot every installed feature may fill, all of them rendered, with
 * `<SlotList>`.
 *
 * The distinction is not "how many features happen to fill it today", it is
 * whether two contributors at once is a mistake or the design. Favorites and
 * the profile page both list one section per object kind, and a KPI section
 * and a report section are not competing for one hole: they are two holes the
 * surface cannot enumerate on its own, because it does not know which kinds
 * this build has. `profile.section` has one contributor today and is still
 * declared here, because a reports section is the obvious next one and
 * registering it as single would make that addition silently drop one.
 *
 * Declared as its own union so a new slot cannot land in the wrong mechanism
 * by accident: `SlotId` is derived from the two, so adding a member means
 * choosing one.
 */
export type MultiSlotId = 'favorites.section' | 'profile.section'

/**
 * A place in a community surface that a feature may fill.
 *
 * A slot exists where the community edition keeps a surface and loses its
 * contents: Home still has a Notable changes section and a hub still has a
 * counter row, but the KPI-backed halves of both leave with the KPI feature.
 * The id names the surface, not the payload.
 *
 * Extended in one place, here, so a new slot cannot be introduced without the
 * props for it being written down beside it.
 */
export type SlotId = SingleSlotId | MultiSlotId

/**
 * What each slot's component is rendered with.
 *
 * `catalog.hubCounters` fills ONE counter tile rather than the whole row: the
 * community component keeps the grid and renders the plain counters itself, and
 * only a counter naming a `kpiId` asks the slot. That is the split that keeps a
 * community hub laid out exactly as an enterprise one, with different tiles in
 * it, instead of two components racing to own the same grid. Every slot below
 * follows it: the community surface keeps its layout, its headings and its
 * empty state, and the slot fills a hole inside them.
 *
 * Props are community types only, on both sides of the loader. A slot whose
 * props named `Kpi` or `Report` would put the feature's own types back on the
 * community surface and there would be nothing left for the seam to do. Where
 * the surface holds an object the feature needs, it passes the community one
 * it already has (`MockDashboard` for the dashboard toolbar) or the identifier
 * the feature can resolve for itself (`userId`, `dashboardId`).
 */
export interface SlotProps {
  'home.notableChanges': Record<string, never>
  'home.aiDigest': Record<string, never>
  'catalog.hubCounters': { counter: HubCounter }
  /** The dashboard being annotated, and the widget the dialog was opened from. */
  'dashboard.annotationSuggest': { dashboardId: number; widgetId: number | null }
  'dashboard.viewActions': { dashboard: MockDashboard }
  /**
   * The datasets one feed delivers into, so the contributor can name what is
   * computed from them. Datasets, not the feed: the join a KPI needs is
   * query-to-dataset, and Feed Health is the only surface that holds the
   * feed-to-dataset half of it.
   */
  'feedHealth.metrics': { datasets: Dataset[] }
  /**
   * No props: a favorites section reads the caller's own starred ids through
   * the community `useVeodynFavorites` and intersects them with its own list.
   */
  'favorites.section': Record<string, never>
  /** Whose profile this is. Ownership is by id, never by display name. */
  'profile.section': { userId: number }
}

/**
 * How a feature fills a slot: a loader for the module whose default export is
 * the component, never the component itself.
 *
 * The same rule as `searchSource`, and for the same reason. This module is
 * reached from the server root layout through src/lib/theme-preference.ts, so a
 * descriptor holding a component value would put that component, and everything
 * it imports, on every route's pre-paint path. A loader is entered when the
 * surface renders and never before.
 */
export type SlotLoader<Id extends SlotId = SlotId> = () => Promise<{
  default: ComponentType<SlotProps[Id]>
}>

/**
 * The slots one feature fills. A mapped type rather than
 * `Partial<Record<SlotId, SlotLoader>>` so each entry's props are checked
 * against that slot's own props, not against the union of every slot's.
 */
export type SlotContributions = { [Id in SlotId]?: SlotLoader<Id> }

/**
 * What a contributed proposal card is rendered with.
 *
 * `proposal` is the opaque wire payload, not the feature's own type: this
 * module is community, so it cannot name `KpiProposal`. The card narrows it on
 * the other side of the loader, where that type is in scope.
 */
export interface ProposalCardProps {
  proposal: FeatureProposal
  /** Called once the object exists, with where to send the user (null = stay). */
  onCreated: (href: string | null) => void
  /** True while a create is in flight, so the chat shell can lock its composer. */
  onBusyChange: (busy: boolean) => void
}

/**
 * A loader for the module whose default export is the card, never the card
 * itself. Same rule as `searchSource` and `SlotLoader`, and for the same
 * reason: a descriptor holding a component value would put that component, and
 * everything it imports, on every route's pre-paint path.
 */
export type ProposalRenderLoader = () => Promise<{ default: ComponentType<ProposalCardProps> }>

/**
 * How a feature claims one `kind` of Create-with-AI proposal.
 *
 * The conversation contract is community: `schemas/ai_create.py` can converge
 * on a proposed KPI on a build that has no endpoint to create one, so a
 * community browser really does receive these. What it does not have is a card,
 * and that is what this contributes.
 *
 * `parse` and the card's own narrowing are two stages, not one check written
 * twice. `parse` runs BEFORE the loader is entered, with only the community
 * types in scope, and answers "is this payload mine, and is it whole enough to
 * be worth fetching a chunk for". The card, on the other side of the loader,
 * narrows the same payload to the feature's own type, which is the only place
 * that type exists. A payload `parse` rejects costs no chunk and renders
 * nothing.
 */
export interface ProposalContribution {
  /** The `kind` discriminator this feature answers for, e.g. `'kpi'`. */
  kind: string
  parse: (raw: unknown) => FeatureProposal | null
  render: ProposalRenderLoader
  /**
   * Where the chat sends someone when the AI cannot finish this kind.
   *
   * On the contribution rather than in the chat's own copy table because it is
   * a ROUTE, and a route belongs to whoever ships it. The table
   * (`MANUAL_PATHS` in components/ai/create-chat/create-chat-model.ts) is keyed
   * by `CreateKind`, which names all five kinds because the SERVICE contract
   * does, so a community build held an escape hatch pointing at `/kpis/new`:
   * a link with nothing behind it. The community kinds keep their entries
   * there; the feature kinds bring their own or offer none.
   *
   * Optional, because a feature can claim a kind without having a manual path
   * to offer, exactly as `dashboard` has no `/dashboards/new` to point at.
   */
  manual?: ProposalManualPath
}

/** A link out of the chat to the by-hand route, with the words on it. */
export interface ProposalManualPath {
  href: string
  label: string
}

/**
 * The mock-mode collections a feature seeds, keyed by collection name.
 *
 * Values are `unknown[]` because this module is community and cannot name
 * `Kpi` or `Report`. The store puts them behind the properties whose types DO
 * name them, and those live with the feature.
 *
 * A loader, like everything else on a descriptor, so the fixtures are not on
 * the pre-paint path. Mock mode is what `pnpm test:e2e` runs on and what the
 * docs screenshots are taken against, so the one property this must hold is
 * that a collection with no contributor reads as `[]` and never as `undefined`.
 */
export type MockDataFactory = () => Promise<Record<string, unknown[]>>

export interface FeatureDescriptor {
  /** Equal to the directory name. Asserted by the boundary guard. */
  id: string
  nav: FeatureNavRow[]
  searchType?: FeatureSearchType
  searchSource?: SearchSourceFactory
  slots?: SlotContributions
  /**
   * The proposal kinds this feature can render a create card for. An array
   * rather than a single entry: nothing says a feature owns exactly one kind.
   */
  proposals?: ProposalContribution[]
  /** What this feature puts in the mock store when there is no backend. */
  mockData?: MockDataFactory
  /**
   * The mock store slices this feature composes in, as module specifiers.
   *
   * STRINGS, and this is the one field that is read by a build script rather
   * than at runtime. `mockData` above carries rows through a loader, which is
   * all a descriptor can do; a slice carries ACTIONS (`addKpi`,
   * `transitionReport`), and those have to be on the object `create()` builds
   * at module scope, where a promise cannot be spread in. So the specifier
   * stays inert data here, and scripts/generate-feature-registry.mjs turns it
   * into a static import in src/stores/generated-mock-slices.ts, which the mock
   * store (and nothing else) imports.
   *
   * Each named module must live under `@/stores/` and export the creator as its
   * DEFAULT export plus its state as `ContributedSliceState`. Both conventions,
   * and the reason a slice may not move into this package directory, are
   * documented in scripts/generate-mock-slices.mjs.
   *
   * An array because nothing says a feature owns exactly one slice: reports
   * composes both its authoring slice and the governed refresh write beside it.
   */
  mockSlices?: string[]
  /** Always an array, never optional, so indexed access types stay valid. */
  routes: FeatureRoute[]
}
