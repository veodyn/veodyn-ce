import type { ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { MockDashboard } from '@/lib/mock-data'
import type { SearchSource } from '@/services/search/types'
import type { Dataset, HubCounter } from '@/types/catalog'
import type { ProposalContribution } from './proposal-types'

export type NavSectionId = 'library' | 'monitor' | 'admin'

export interface FeatureNavRow {
  label: string
  href: string
  icon: LucideIcon
  /**
   * Which sidebar section this row belongs to, and the only gating signal: the
   * 'admin' section renders for admins only (buildSidebarSections in
   * lib/sidebar-nav.ts), so a row placed there is already admin-only.
   */
  section: NavSectionId
}

/**
 * A feature's identity in federated search. The code that fetches the results
 * is a separate field, `searchSource`, so either one without the other is a
 * shape the type system allows and the assembler handles.
 */
export interface FeatureSearchType {
  type: string
  label: string
  noun: string
  icon: LucideIcon
}

/**
 * How a feature contributes results to federated search. A factory, not a
 * `SearchSource` value: this module is reached from the server root layout
 * through src/lib/theme-preference.ts, so a descriptor that built the value
 * here would pull the feature's client onto every route's pre-paint path.
 *
 * Assembled by features/search-sources.ts.
 */
export type SearchSourceFactory = () => Promise<SearchSource>

/**
 * A route this feature owns. A RegExp and not a prefix, because the rules are
 * exact: the print route is /^\/reports\/[^/]+\/print\/?$/ and a /reports/
 * prefix would match every report page.
 */
export interface FeatureRoute {
  pattern: RegExp
  /** Omit the app shell entirely, e.g. an unattended wall display. */
  bareChrome?: boolean
  forcedTheme?: 'light' | 'dark'
}

/**
 * A slot exactly one feature may fill, rendered with `<Slot>`. First
 * contributor wins and the rest are ignored: each of these surfaces is one
 * place showing either the community answer or one feature's answer instead of
 * it. Two features filling one is a packaging mistake, and `<Slot>` renders the
 * first rather than refusing to render the surface.
 */
export type SingleSlotId =
  | 'home.notableChanges'
  | 'home.aiDigest'
  | 'catalog.hubCounters'
  | 'dashboard.annotationSuggest'
  | 'dashboard.viewActions'
  | 'feedHealth.metrics'
  | 'publishedFeed.tokenPanel'
  | 'publishedFeed.blockedAttribution'
  | 'dataset.records'
  | 'dataset.headerActions'

/**
 * A slot every installed feature may fill, all of them rendered, with
 * `<SlotList>`. The test is whether two contributors at once is a mistake or
 * the design: favorites and the profile page list one section per object kind,
 * which the surface cannot enumerate on its own.
 *
 * Its own union so a new slot cannot land in the wrong mechanism by accident:
 * `SlotId` is derived from the two, so adding a member means choosing one.
 */
export type MultiSlotId = 'favorites.section' | 'profile.section'

/**
 * A place in a community surface that a feature may fill. A slot exists where
 * the community edition keeps a surface and loses its contents: Home still has
 * a Notable changes section and a hub still has a counter row. The id names the
 * surface, not the payload.
 */
export type SlotId = SingleSlotId | MultiSlotId

/**
 * What each slot's component is rendered with.
 *
 * The community surface keeps its layout, headings and empty state, and the
 * slot fills a hole inside them: `catalog.hubCounters` fills ONE counter tile
 * rather than the whole row, and only a counter naming a `kpiId` asks the slot.
 *
 * Props are community types only, on both sides of the loader. Where the
 * surface holds an object the feature needs, it passes the community one it
 * already has (`MockDashboard`) or the identifier the feature can resolve for
 * itself (`userId`, `dashboardId`).
 */
export interface SlotProps {
  'home.notableChanges': Record<string, never>
  'home.aiDigest': Record<string, never>
  'catalog.hubCounters': { counter: HubCounter }
  /** The dashboard being annotated, and the widget the dialog was opened from. */
  'dashboard.annotationSuggest': { dashboardId: number; widgetId: number | null }
  'dashboard.viewActions': { dashboard: MockDashboard }
  /**
   * The datasets one feed delivers into. Datasets, not the feed: the join a KPI
   * needs is query-to-dataset, and Feed Health is the only surface holding the
   * feed-to-dataset half of it.
   */
  'feedHealth.metrics': { datasets: Dataset[] }
  /**
   * The private-feed token panel on a published feed's detail page. The slug,
   * not a token type: token issuance, rotation and revocation are enterprise's
   * own model (design section 4), so this community surface can loan only which
   * feed is on screen.
   */
  'publishedFeed.tokenPanel': { slug: string }
  /**
   * What identifies a blocked publish attempt, for the feature that claims
   * attribution on it (design section 7). `attemptId` plus its feed, both
   * already in the community attempt history; not a `Finding`, which is the
   * validator's own shape.
   */
  'publishedFeed.blockedAttribution': { slug: string; attemptId: number }
  /**
   * No props: a favorites section reads the caller's own starred ids through
   * the community `useVeodynFavorites` and intersects them with its own list.
   */
  'favorites.section': Record<string, never>
  /** Whose profile this is. Ownership is by id, never by display name. */
  'profile.section': { userId: number }
  /**
   * The dataset itself, not just its id: a record editor needs the writable
   * flag and the declared columns to render the right form, and the detail page
   * has already fetched both.
   */
  'dataset.records': { dataset: Dataset }
  /**
   * Beside "Query this dataset" in the page header, for actions a feature adds
   * to a dataset rather than to its rows. Separate from `dataset.records`,
   * which mounts a whole editor at the foot of the page.
   */
  'dataset.headerActions': { dataset: Dataset }
}

/**
 * How a feature fills a slot: a loader for the module whose default export is
 * the component, never the component itself. Same pre-paint rule as
 * `searchSource` above.
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
 * The mock-mode collections a feature seeds, keyed by collection name. Values
 * are `unknown[]` because this module is community and cannot name `Kpi` or
 * `Report`; the store puts them behind the properties whose types do.
 *
 * A loader, so the fixtures stay off the pre-paint path. `pnpm test:e2e` and
 * the docs screenshots run on mock mode, so a collection with no contributor
 * must read as `[]` and never as `undefined`.
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
   * because nothing says a feature owns exactly one kind. The type lives in
   * ./proposal-types, split out from here for size.
   */
  proposals?: ProposalContribution[]
  /** What this feature puts in the mock store when there is no backend. */
  mockData?: MockDataFactory
  /**
   * The mock store slices this feature composes in, as module specifiers.
   *
   * STRINGS, and the one field read by a build script rather than at runtime.
   * `mockData` carries rows through a loader; a slice carries ACTIONS
   * (`addKpi`, `transitionReport`), which have to be on the object `create()`
   * builds at module scope, where a promise cannot be spread in. So the
   * specifier stays inert data here and the generator turns it into a static
   * import in src/stores/generated-mock-slices.ts, which the mock store (and
   * nothing else) imports.
   *
   * Each named module must live under `@/stores/` and export the creator as its
   * DEFAULT export plus its state as `ContributedSliceState`; both conventions
   * are documented in scripts/generate-mock-slices.mjs.
   *
   * An array because a feature may own more than one: reports composes both its
   * authoring slice and the governed refresh write beside it.
   */
  mockSlices?: string[]
  /** Always an array, never optional, so indexed access types stay valid. */
  routes: FeatureRoute[]
}
