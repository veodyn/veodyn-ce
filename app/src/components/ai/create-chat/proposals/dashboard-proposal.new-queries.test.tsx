// A dashboard that writes the queries it needs.
//
// The conversation used to be able to assemble only what already existed, so a
// request for a dashboard of things nobody had queried yet came back as advice
// to go and write them by hand. A panel can now carry a query instead of an id,
// and the order is what these tests are about: the query is written first,
// because a widget points at a visualization and a visualization does not exist
// until its query does.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders, resetStores } from '@/test/utils'
import { useMockDataStore } from '@/stores/mock-data-store'
import type { DashboardProposal } from '@/types/ai-create'
import { DashboardProposalCard } from './dashboard-proposal'

interface WidgetCall {
  dashboardId: number
  visualization?: { id: number; query: { id: number }; type: string; name: string }
}

const writes = vi.hoisted(() => ({
  order: [] as string[],
  widgets: [] as WidgetCall[],
  failQueryNamed: null as string | null,
}))

vi.mock('@/hooks/use-widgets', () => ({
  useCreateWidget: () => ({
    mutateAsync: async (vars: WidgetCall) => {
      writes.order.push('widget')
      writes.widgets.push(vars)
      return vars
    },
  }),
  useDeleteWidget: () => ({ mutateAsync: async () => undefined }),
}))

vi.mock('@/hooks/use-queries', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    useCreateQuery: () => ({
      mutateAsync: async (vars: { name: string; query: string; data_source_id: number }) => {
        writes.order.push(`query:${vars.name}`)
        if (vars.name === writes.failQueryNamed) throw new Error('Query refused')
        return {
          id: 4242,
          name: vars.name,
          query: vars.query,
          data_source_id: vars.data_source_id,
          visualizations: [{ id: 9001, type: 'TABLE', name: 'Table', options: {} }],
        }
      },
    }),
  }
})

const SQL = 'SELECT toStartOfHour(captured_at) AS hour, count() AS rows FROM stations GROUP BY hour'

const PROPOSAL: DashboardProposal = {
  kind: 'dashboard',
  name: 'Bikeshare situational',
  widgets: [
    { title: 'Stations low on bikes', queryId: 1, visualizationId: 101, vizChoiceId: null, newQuery: null },
    {
      title: 'Rows per hour',
      queryId: null,
      visualizationId: null,
      vizChoiceId: null,
      newQuery: {
        name: 'Rows per hour',
        description: 'Arrivals by hour.',
        sql: SQL,
        datasetTable: 'stations',
        vizChoiceId: 'table',
        vizOptions: {},
      },
    },
  ],
}

function renderCard(onCreated = vi.fn()) {
  renderWithProviders(
    <DashboardProposalCard proposal={PROPOSAL} onCreated={onCreated} onBusyChange={vi.fn()} />
  )
  return onCreated
}

beforeEach(() => {
  writes.order = []
  writes.widgets = []
  writes.failQueryNamed = null
  resetStores()
})

describe('a dashboard proposal that writes a query', () => {
  it('says what it is about to write, on the button and in the panel', async () => {
    renderCard()

    // Named on the control, because pressing it puts a query into the instance
    // as well as building a dashboard.
    expect(await screen.findByRole('button', { name: 'Create dashboard + 1 query' })).toBeInTheDocument()
    const panels = screen.getByRole('list')
    expect(within(panels).getByText('New query')).toBeInTheDocument()
    // And the SQL is readable before anyone presses it.
    await userEvent.setup().click(within(panels).getByText(/show SQL/))
    expect(within(panels).getByText(SQL)).toBeVisible()
  })

  it('writes the query before the dashboard, and points the widget at it', async () => {
    const user = userEvent.setup()
    renderCard()

    await user.click(await screen.findByRole('button', { name: /^Create dashboard/ }))

    await waitFor(() => expect(writes.widgets).toHaveLength(2))
    // The query first: a widget points at a visualization, which does not exist
    // until its query does.
    expect(writes.order[0]).toBe('query:Rows per hour')
    const written = writes.widgets.find((call) => call.visualization?.query.id === 4242)
    expect(written?.visualization?.id).toBe(9001)
    // The existing panel is untouched by any of this.
    expect(writes.widgets.some((call) => call.visualization?.query.id === 1)).toBe(true)
  })

  it('reports the panel whose query could not be written, and builds the rest', async () => {
    const user = userEvent.setup()
    writes.failQueryNamed = 'Rows per hour'
    renderCard()

    await user.click(await screen.findByRole('button', { name: /^Create dashboard/ }))

    // The dashboard is still worth having, and the panel that did not land is
    // named rather than silently missing.
    await waitFor(() => expect(writes.widgets).toHaveLength(1))
    expect(writes.widgets[0]?.visualization?.query.id).toBe(1)
    expect(await screen.findByText(/Rows per hour/)).toBeInTheDocument()
  })

  it('keeps the plain wording when nothing is being written', async () => {
    renderWithProviders(
      <DashboardProposalCard
        proposal={{ ...PROPOSAL, widgets: [PROPOSAL.widgets[0]] }}
        onCreated={vi.fn()}
        onBusyChange={vi.fn()}
      />
    )

    expect(await screen.findByRole('button', { name: 'Create dashboard' })).toBeInTheDocument()
    // No source picker either: an assembled dashboard takes its connection from
    // the queries it points at, so there is no decision to ask about.
    expect(screen.queryByText('Data source for the new queries')).not.toBeInTheDocument()
  })
})

describe('the mock store', () => {
  it('is untouched by these tests', () => {
    expect(useMockDataStore.getState().dashboards.length).toBeGreaterThan(0)
  })
})

