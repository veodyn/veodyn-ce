// Pure helpers behind the proposal cards. No React and no I/O, so every
// decision a card makes about what it is going to write can be tested on its
// own (the kpi-form-model and report-outline-model precedent).
//
// Community only. The KPI half of this module (band derivation and building a
// whole Kpi from a proposal) moved to src/components/kpi/kpi-proposal-model.ts
// with the card that calls it: it is stated in KPI terms, so it cannot compile
// in a build with no KPI feature.
import { isAppError } from '@/lib/errorIds'
import type { AnyProposal, Proposal } from '@/types/ai-create'

/** The shape the data-source select needs, and nothing more. */
export interface DataSourceOption {
  id: number
  name: string
  type: string
}

/**
 * The kinds ProposalPanel draws itself, as values rather than as a type.
 *
 * `Proposal` is a compile-time union and this is the runtime half of it. The
 * two are kept in step by the annotation: an element that is not a member of
 * `Proposal['kind']` fails to compile, and a member missing from this list
 * makes the panel's switch non-exhaustive, which is also a tsc error.
 */
const COMMUNITY_PROPOSAL_KINDS: readonly Proposal['kind'][] = ['query', 'dashboard', 'snippet']

/**
 * Whether this is a kind the community tree has a card for.
 *
 * The one crossing from `AnyProposal` to `Proposal`, and the reason it has to
 * be a hand-written predicate: the wire type is deliberately open (a build can
 * receive a kind an installed feature owns, or a kind nothing owns at all), so
 * a discriminant check alone cannot narrow it. Everything that is not community
 * goes to the registry (src/features/proposals.ts).
 */
export function isCommunityProposal(proposal: AnyProposal): proposal is Proposal {
  return (COMMUNITY_PROPOSAL_KINDS as readonly string[]).includes(proposal.kind)
}

// A query proposal carries no data source id: the service has no data source
// listing to resolve one from honestly (spec 6.1). The browser picks the
// default here and the card shows a select whenever there is a choice, so the
// user sees what the query will be written against before pressing Create.
// ClickHouse first because generated SQL is grounded on the ClickHouse catalog.
export function defaultDataSourceId(dataSources: DataSourceOption[]): number | null {
  const clickhouse = dataSources.find((source) =>
    source.type.toLowerCase().includes('clickhouse')
  )
  return clickhouse?.id ?? dataSources[0]?.id ?? null
}

/** Drop one entry, used by the dashboard card's removable widget list. */
export function removeAt<T>(items: T[], index: number): T[] {
  return items.filter((_, position) => position !== index)
}

// Widgets land in a two-column layout on the six-column dashboard grid
// (dashboard-grid.tsx `cols={{lg: 6}}`), so half width is sizeX 3.
export const WIDGET_SIZE = { sizeX: 3, sizeY: 8 }

export function widgetPosition(index: number): {
  col: number
  row: number
  sizeX: number
  sizeY: number
} {
  return {
    col: (index % 2) * WIDGET_SIZE.sizeX,
    row: Math.floor(index / 2) * WIDGET_SIZE.sizeY,
    sizeX: WIDGET_SIZE.sizeX,
    sizeY: WIDGET_SIZE.sizeY,
  }
}

// A dashboard whose widgets did not all land is still a dashboard, so the user
// is taken to it (spec section 7). What must not happen is calling that a
// success: name every widget that is missing, so the gap is not discovered
// later as a dashboard that quietly has fewer panels than it was shown.
export function partialDashboardMessage(failedTitles: string[]): string | null {
  if (failedTitles.length === 0) return null
  const noun = failedTitles.length === 1 ? 'widget' : 'widgets'
  return `The dashboard was created, but ${failedTitles.length} ${noun} could not be added: ${failedTitles.join(', ')}. Add them from the query page.`
}

// Turn a rejected create into something the user can act on, keeping the
// proposal on screen. An AppError carries the registry id the support request
// greps for, so it is surfaced rather than flattened into the generic form.
export function createErrorMessage(objectLabel: string, error: unknown): string | null {
  if (error == null) return null
  if (isAppError(error)) return `Could not create this ${objectLabel}. ${error.message} [${error.id}]`
  if (error instanceof Error) return `Could not create this ${objectLabel}. ${error.message}`
  return `Could not create this ${objectLabel}.`
}
