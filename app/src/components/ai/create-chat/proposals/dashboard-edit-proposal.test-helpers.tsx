// Shared fixtures for dashboard-edit-proposal.test.tsx, split out so the test
// file itself stays under the file-size threshold. vi.mock('@/hooks/use-widgets',
// ...) stays in the test file: it has to sit beside the vi.hoisted() state it
// closes over, and vitest hoists a vi.mock call only within its own file.
import { vi } from 'vitest'
import { mockQueries } from '@/lib/mock-data'
import { useMockDataStore } from '@/stores/mock-data-store'
import { Toaster } from '@/components/ui/sonner'
import { renderWithProviders } from '@/test/utils'
import type { DashboardProposal } from '@/types/ai-create'
import { DashboardEditProposalCard } from './dashboard-edit-proposal'

export const DASHBOARD_ID = 1

// Throws rather than asserting non-null at each call site: a fixture that no
// longer holds a spare query is a broken fixture, and saying so once beats
// three silenced type errors.
export function firstAbsentQuery(present: number[]): number {
  const query = mockQueries.find((one) => !present.includes(one.id))
  if (!query) throw new Error('Expected a query the dashboard does not already chart')
  return query.id
}

// Query-backed only. The text box on this fixture is never a removal
// candidate, and counting it as one would make the expectations below wrong
// in exactly the way the card is right.
export function removableWidgets(exceptQueryId: number) {
  return currentWidgets().filter((one) => {
    const queryId = one.visualization?.query?.id
    return queryId != null && queryId !== exceptQueryId
  })
}

export function currentWidgets() {
  const dashboard = useMockDataStore.getState().dashboards.find((one) => one.id === DASHBOARD_ID)
  return dashboard?.widgets ?? []
}

/**
 * A proposal naming these queries, each drawn as the dashboard already draws it.
 *
 * The visualization id is read off the real widget rather than invented. A
 * widget is a query AND a shape now, so an invented id would make every query
 * the proposal repeats read as a REDRAW, and these tests are about which panels
 * get added and removed. `redrawnAs` below is the fixture for the other case.
 */
export function proposalOf(queryIds: number[]): DashboardProposal {
  const shown = new Map<number, number>()
  for (const widget of currentWidgets()) {
    const queryId = widget.visualization?.query?.id
    const visualizationId = widget.visualization?.id
    if (queryId != null && visualizationId != null && !shown.has(queryId)) {
      shown.set(queryId, visualizationId)
    }
  }
  return {
    kind: 'dashboard',
    name: 'unused when editing',
    widgets: queryIds.map((queryId) => ({
      title: `Panel for ${queryId}`,
      // The fallback is for a query the dashboard does not chart yet, which is
      // an addition: nothing compares against it.
      visualizationId: shown.get(queryId) ?? queryId * 100 + 1,
      queryId,
      vizChoiceId: null,
      newQuery: null,
    })),
  }
}

/** The same queries, but one of them asked for as a different shape. */
export function redrawnAs(
  queryIds: number[],
  queryId: number,
  vizChoiceId: string
): DashboardProposal {
  const base = proposalOf(queryIds)
  return {
    ...base,
    widgets: base.widgets.map((widget) =>
      widget.queryId === queryId
        ? // Null id beside a shape: the query has nothing of that shape, so the
          // card has to build one, forking the query when it is not the
          // reader's. That is the path worth pinning.
          { ...widget, visualizationId: null, vizChoiceId }
        : widget
    ),
  }
}

// The card reads the dashboard through a query, so it renders once knowing
// nothing and again with the widgets. Both renders produce a summary
// sentence, so waiting for "a summary" waits for nothing: the first one says
// "keeping 0 of the 0 already here" and every assertion below would run
// against a card that thinks the dashboard is empty. Each test waits for the
// text that only its own loaded state produces.
//
// Renders the real Toaster alongside the card so a test that cares what a
// partial apply reports can query the DOM for it instead of a spy call.
export function renderCard(proposal: DashboardProposal, onCreated = vi.fn()) {
  renderWithProviders(
    <>
      <DashboardEditProposalCard
        proposal={proposal}
        dashboardId={DASHBOARD_ID}
        onCreated={onCreated}
        onBusyChange={vi.fn()}
      />
      <Toaster />
    </>
  )
  return { onCreated }
}
