// Redrawing a widget: same query, different shape.
//
// The case the card could not represent at all. Every query stayed, the diff
// matched on query id alone, and a proposal that turned six tables into charts
// arrived as "No change to this dashboard". Separate file from
// dashboard-edit-proposal.test.tsx because it needs its own fakes for the two
// things a redraw touches that an add or a remove never does: creating a
// visualization, and forking the query when the reader does not own it.
//
// The fork is the part worth pinning. A visualization lives on the SAVED QUERY,
// which every other dashboard reading that query shares, so building one there
// to satisfy a change to this dashboard is a side effect its owner never asked
// for.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDashboards, mockQueries } from '@/lib/mock-data'
import { buildCurrentUser } from '@/stores/auth-identity'
import { useAuthStore } from '@/stores/auth-store'
import { useMockDataStore } from '@/stores/mock-data-store'
import { resetStores } from '@/test/utils'
import {
  currentWidgets,
  proposalOf,
  redrawnAs,
  renderCard,
} from './dashboard-edit-proposal.test-helpers'

interface CreateCall {
  dashboardId: number
  visualization?: { id: number; query: { id: number }; type?: string }
  options?: Record<string, unknown> & {
    position: { col: number; row: number; sizeX: number; sizeY: number }
  }
}

const widgets = vi.hoisted(() => ({
  created: [] as CreateCall[],
  deleted: [] as { widgetId: number }[],
  // Without this the delete-succeeded/create-refused path cannot be reached,
  // and that path is exactly where a widget goes missing for good.
  failCreate: false,
  failDeleteId: null as number | null,
}))

const viz = vi.hoisted(() => ({
  created: [] as { queryId: number; type: string; options: Record<string, unknown> }[],
  nextId: 7000,
  fail: false,
}))

const forks = vi.hoisted(() => ({ of: [] as number[], nextId: 8000 }))

vi.mock('@/hooks/use-widgets', () => ({
  useCreateWidget: () => ({
    mutateAsync: async (vars: CreateCall) => {
      if (widgets.failCreate) throw new Error('Widget refused')
      widgets.created.push(vars)
      return vars
    },
  }),
  useDeleteWidget: () => ({
    mutateAsync: async (vars: { widgetId: number }) => {
      widgets.deleted.push(vars)
      if (vars.widgetId === widgets.failDeleteId) throw new Error('Widget refused')
      return vars
    },
  }),
}))

vi.mock('@/hooks/use-visualizations', () => ({
  useCreateVisualization: () => ({
    isPending: false,
    mutateAsync: async (vars: { queryId: number; type: string; options: Record<string, unknown> }) => {
      if (viz.fail) throw new Error('Visualization refused')
      viz.created.push(vars)
      viz.nextId += 1
      return { id: viz.nextId, ...vars }
    },
  }),
}))

vi.mock('@/hooks/use-queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/use-queries')>()),
  useForkQuery: () => ({
    isPending: false,
    mutateAsync: async (id: number) => {
      forks.of.push(id)
      forks.nextId += 1
      const original = useMockDataStore.getState().queries.find((one) => one.id === id)
      return { ...original, id: forks.nextId, name: `Copy of ${original?.name ?? id}` }
    },
  }),
  useUpdateQuery: () => ({ isPending: false, mutateAsync: async (vars: unknown) => vars }),
}))

/** The query behind the first query-backed widget on the fixture dashboard. */
function chartedQueryId(): number {
  const widget = currentWidgets().find((one) => one.visualization?.query?.id != null)
  const queryId = widget?.visualization?.query?.id
  if (queryId == null) throw new Error('Expected the fixture dashboard to chart something')
  return queryId
}

function everyChartedQueryId(): number[] {
  return currentWidgets()
    .map((one) => one.visualization?.query?.id)
    .filter((id): id is number => id != null)
}

function ownQuery(queryId: number, ownerId: number) {
  useMockDataStore.setState({
    queries: useMockDataStore.getState().queries.map((one) =>
      one.id === queryId ? { ...one, user: { ...one.user, id: ownerId } } : one
    ),
  })
}

// resetStores clears currentUser by design, and every assertion here turns on
// who the reader is. ME owns nothing on the fixture until a test says so.
const ME = 4242

beforeEach(() => {
  resetStores()
  useAuthStore.setState({
    isAuthenticated: true,
    currentUser: buildCurrentUser({ id: ME, name: 'Reader', email: 'reader@example.test' }),
  })
  widgets.created = []
  widgets.deleted = []
  widgets.failCreate = false
  widgets.failDeleteId = null
  viz.created = []
  viz.fail = false
  forks.of = []
  useMockDataStore.setState({
    dashboards: mockDashboards.map((dashboard) => ({ ...dashboard })),
    queries: mockQueries.map((query) => ({ ...query })),
  })
})

describe('redrawing a widget', () => {
  it('offers the change instead of reporting that nothing differs', async () => {
    const queryId = chartedQueryId()

    renderCard(redrawnAs(everyChartedQueryId(), queryId, 'chart-bar'))

    expect(await screen.findByText(/redraw 1 widget/i)).toBeInTheDocument()
    expect(screen.queryByText(/no change to this dashboard/i)).not.toBeInTheDocument()
  })

  it('builds the visualization on the query itself when the reader owns it', async () => {
    const queryId = chartedQueryId()
    ownQuery(queryId, ME)

    renderCard(redrawnAs(everyChartedQueryId(), queryId, 'chart-bar'))
    await screen.findByText(/redraw 1 widget/i)
    await userEvent.click(screen.getByRole('button', { name: /apply change/i }))

    await waitFor(() => expect(viz.created).toHaveLength(1))
    expect(forks.of).toEqual([])
    expect(viz.created[0]?.queryId).toBe(queryId)
    expect(viz.created[0]?.options).toMatchObject({ globalSeriesType: 'bar' })
  })

  it('forks a query the reader does not own and builds on the copy', async () => {
    // The rule this file exists for. Adding a chart to somebody else's saved
    // query changes what every other dashboard on it offers.
    const queryId = chartedQueryId()
    ownQuery(queryId, ME + 1000)

    renderCard(redrawnAs(everyChartedQueryId(), queryId, 'chart-bar'))
    await screen.findByText(/redraw 1 widget/i)
    await userEvent.click(screen.getByRole('button', { name: /apply change/i }))

    await waitFor(() => expect(widgets.created).toHaveLength(1))
    expect(forks.of).toEqual([queryId])
    // On the COPY, never on the original.
    expect(viz.created[0]?.queryId).not.toBe(queryId)
    expect(viz.created[0]?.queryId).toBe(forks.nextId)
    // And the panel actually reads the copy. Asserting only that a fork and a
    // visualization happened would pass just as well with the widget still
    // pointing at the original query, which is the bug worth catching.
    expect(widgets.created[0]?.visualization?.query.id).toBe(forks.nextId)
    expect(widgets.created[0]?.visualization?.id).toBe(viz.nextId)
  })

  it('replaces the panel in place rather than moving it to the bottom', async () => {
    const queryId = chartedQueryId()
    const before = currentWidgets().find((one) => one.visualization?.query?.id === queryId)
    ownQuery(queryId, ME)

    renderCard(redrawnAs(everyChartedQueryId(), queryId, 'chart-bar'))
    await screen.findByText(/redraw 1 widget/i)
    await userEvent.click(screen.getByRole('button', { name: /apply change/i }))

    await waitFor(() => expect(widgets.created).toHaveLength(1))
    expect(widgets.deleted.map((one) => one.widgetId)).toEqual([before?.id])
    expect(widgets.created[0]?.options?.position).toEqual(before?.options.position)
  })

  it('leaves the panel standing when the visualization cannot be built', async () => {
    // The visualization is resolved BEFORE the delete on purpose. The other
    // order leaves a hole on the dashboard whenever the fork or the create
    // fails, and the analyst is told the widget could not be redrawn while
    // looking at the empty space where it used to be.
    const queryId = chartedQueryId()
    ownQuery(queryId, ME)
    viz.fail = true

    renderCard(redrawnAs(everyChartedQueryId(), queryId, 'chart-bar'))
    await screen.findByText(/redraw 1 widget/i)
    await userEvent.click(screen.getByRole('button', { name: /apply change/i }))

    // Named as a failure, and the original panel never deleted.
    expect(await screen.findByText(/except for 1 widget/i)).toBeInTheDocument()
    expect(widgets.deleted).toEqual([])
    expect(widgets.created).toEqual([])
  })

  it('never leaves a hole when the replacement panel is refused', async () => {
    // The create runs BEFORE the delete for this reason. Deleting first would
    // make a refused create a widget the analyst loses outright, with nothing
    // in the card able to put it back.
    const queryId = chartedQueryId()
    ownQuery(queryId, ME)
    widgets.failCreate = true

    renderCard(redrawnAs(everyChartedQueryId(), queryId, 'chart-bar'))
    await screen.findByText(/redraw 1 widget/i)
    await userEvent.click(screen.getByRole('button', { name: /apply change/i }))

    expect(await screen.findByText(/except for 1 widget/i)).toBeInTheDocument()
    // The original panel is still on the dashboard.
    expect(widgets.deleted).toEqual([])
  })

  it('takes the replacement back out when the original will not go', async () => {
    // Otherwise the dashboard is left with two panels stacked in one place, and
    // the grid compacts overlapping widgets and SAVES where it moved them, so
    // the leftover does not stay a tidy duplicate: it rearranges the page.
    const queryId = chartedQueryId()
    const original = currentWidgets().find((one) => one.visualization?.query?.id === queryId)
    ownQuery(queryId, ME)
    widgets.failDeleteId = original?.id ?? null

    renderCard(redrawnAs(everyChartedQueryId(), queryId, 'chart-bar'))
    await screen.findByText(/redraw 1 widget/i)
    await userEvent.click(screen.getByRole('button', { name: /apply change/i }))

    expect(await screen.findByText(/except for 1 widget/i)).toBeInTheDocument()
    // Both deletes were attempted: the original, then the replacement it could
    // not replace.
    expect(widgets.deleted).toHaveLength(2)
    expect(widgets.deleted[0]?.widgetId).toBe(original?.id)
    expect(widgets.deleted[1]?.widgetId).not.toBe(original?.id)
  })

  it('carries the original panel options across, not just its position', async () => {
    // parameterMappings is how a dashboard filter reaches a widget, and
    // isHidden is a widget somebody deliberately put away. Copying the position
    // alone unhooks the first and reveals the second, neither of which is a
    // redraw.
    const queryId = chartedQueryId()
    ownQuery(queryId, ME)
    const original = currentWidgets().find((one) => one.visualization?.query?.id === queryId)
    if (original == null) throw new Error('Expected a panel to redraw')
    useMockDataStore.setState({
      dashboards: useMockDataStore.getState().dashboards.map((dashboard) => ({
        ...dashboard,
        widgets: dashboard.widgets.map((one) =>
          one.id === original.id
            ? { ...one, options: { ...one.options, parameterMappings: { city: { type: 'dashboard-level' } } } }
            : one
        ),
      })),
    })

    renderCard(redrawnAs(everyChartedQueryId(), queryId, 'chart-bar'))
    await screen.findByText(/redraw 1 widget/i)
    await userEvent.click(screen.getByRole('button', { name: /apply change/i }))

    await waitFor(() => expect(widgets.created).toHaveLength(1))
    expect(widgets.created[0]?.options).toMatchObject({
      parameterMappings: { city: { type: 'dashboard-level' } },
    })
  })

  it('still reports no change when every widget keeps its own shape', async () => {
    renderCard(proposalOf(everyChartedQueryId()))

    expect(await screen.findByText(/no change to this dashboard/i)).toBeInTheDocument()
  })
})
