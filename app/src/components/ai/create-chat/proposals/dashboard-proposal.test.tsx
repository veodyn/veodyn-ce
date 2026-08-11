import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDashboards, mockQueries } from '@/lib/mock-data'
import { useMockDataStore } from '@/stores/mock-data-store'
import { Toaster } from '@/components/ui/sonner'
import { renderWithProviders, resetStores } from '@/test/utils'
import type { DashboardProposal } from '@/types/ai-create'
import { DashboardProposalCard } from './dashboard-proposal'

interface WidgetCall {
  dashboardId: number
  visualization?: { id: number; query: { id: number }; type: string; name: string }
  options: { position: { col: number; row: number; sizeX: number; sizeY: number } }
}

// Only the widget hook is faked, and only because mock mode has no way to make
// one widget out of several fail. Everything else (the dashboard create, the
// query list the names come from) is the real thing against the mock store.
const widgets = vi.hoisted(() => ({
  calls: [] as WidgetCall[],
  failVisualizationId: null as number | null,
}))

vi.mock('@/hooks/use-widgets', () => ({
  useCreateWidget: () => ({
    mutateAsync: async (vars: WidgetCall) => {
      widgets.calls.push(vars)
      if (vars.visualization?.id === widgets.failVisualizationId) {
        throw new Error('Widget refused')
      }
      return vars
    },
  }),
}))

const PROPOSAL: DashboardProposal = {
  kind: 'dashboard',
  name: 'Transit health',
  widgets: [
    { title: 'Daily ridership', queryId: 1, visualizationId: 101, vizChoiceId: null, newQuery: null },
    { title: 'Air quality', queryId: 2, visualizationId: 201, vizChoiceId: null, newQuery: null },
    { title: 'Bike trips', queryId: 6, visualizationId: 601, vizChoiceId: null, newQuery: null },
  ],
}

// Renders the real Toaster alongside the card, so a test that cares what a
// partial create reports can query the DOM for it instead of a spy call.
function renderCard(onCreated = vi.fn(), onBusyChange = vi.fn()) {
  renderWithProviders(
    <>
      <DashboardProposalCard
        proposal={PROPOSAL}
        onCreated={onCreated}
        onBusyChange={onBusyChange}
      />
      <Toaster />
    </>
  )
  return { onCreated, onBusyChange }
}

function storedDashboard(name: string) {
  return useMockDataStore.getState().dashboards.find((dashboard) => dashboard.name === name)
}

beforeEach(() => {
  resetStores()
  widgets.calls = []
  widgets.failVisualizationId = null
  useMockDataStore.setState({
    dashboards: mockDashboards.map((dashboard) => ({ ...dashboard })),
    queries: mockQueries.map((query) => ({ ...query })),
  })
})

describe('DashboardProposalCard', () => {
  it('writes the edited name and only the panels that were kept', async () => {
    const user = userEvent.setup()
    const { onCreated } = renderCard()

    const name = screen.getByLabelText('Dashboard name')
    await user.clear(name)
    await user.type(name, 'Transit health overview')
    await user.click(screen.getByRole('button', { name: 'Remove Air quality' }))

    await user.click(screen.getByRole('button', { name: 'Create dashboard' }))

    await waitFor(() => expect(storedDashboard('Transit health overview')).toBeDefined())
    expect(storedDashboard('Transit health')).toBeUndefined()
    expect(widgets.calls.map((call) => call.visualization?.id)).toEqual([101, 601])
    // The removed panel is gone from the write, not merely hidden.
    expect(widgets.calls.some((call) => call.visualization?.id === 201)).toBe(false)
    expect(onCreated).toHaveBeenCalledWith(
      `/dashboards/${storedDashboard('Transit health overview')?.id}`
    )
  })

  it('lays the panels out two to a row, renumbered after a removal', async () => {
    const user = userEvent.setup()
    renderCard()

    await user.click(screen.getByRole('button', { name: 'Remove Daily ridership' }))
    await user.click(screen.getByRole('button', { name: 'Create dashboard' }))

    await waitFor(() => expect(widgets.calls).toHaveLength(2))
    expect(widgets.calls.map((call) => call.options.position)).toEqual([
      { col: 0, row: 0, sizeX: 3, sizeY: 8 },
      { col: 3, row: 0, sizeX: 3, sizeY: 8 },
    ])
  })

  it('navigates after a partial create and names the panel that did not land', async () => {
    const user = userEvent.setup()
    widgets.failVisualizationId = 201
    const { onCreated } = renderCard()

    await user.click(screen.getByRole('button', { name: 'Create dashboard' }))

    await waitFor(() => expect(onCreated).toHaveBeenCalled())
    // The dashboard exists, so the user is taken to it, but the failure is
    // reported rather than swallowed. Scoped to role="alert" (a partial-apply
    // caution is assertive) rather than a bare text query: the same message
    // is also painted by the visible toast, so an unscoped query matches
    // twice.
    expect(onCreated).toHaveBeenCalledWith(`/dashboards/${storedDashboard('Transit health')?.id}`)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Air quality'))
    expect(screen.getByRole('alert')).not.toHaveTextContent('Daily ridership')
    // One widget failing did not stop the ones after it.
    expect(widgets.calls.map((call) => call.visualization?.id)).toEqual([101, 201, 601])
  })

  it('says nothing about failures when every panel lands', async () => {
    const user = userEvent.setup()
    renderCard()

    await user.click(screen.getByRole('button', { name: 'Create dashboard' }))

    await waitFor(() => expect(widgets.calls).toHaveLength(3))
    // The assertive mirror stays mounted even when empty (this app does not
    // mirror the polite case at all, since sonner's own aria-live="polite"
    // region already covers success), so a whole create leaves it carrying
    // no text.
    expect(screen.getByRole('alert')).toBeEmptyDOMElement()
  })

  it('shows the query behind each panel', async () => {
    renderCard()

    expect(await screen.findByText(mockQueries.find((q) => q.id === 1)?.name ?? '')).toBeVisible()
    expect(screen.getByText('Air Quality Index by Station')).toBeVisible()
  })

  it('creates nothing at all when the dashboard itself is refused', async () => {
    const user = userEvent.setup()
    useMockDataStore.setState({
      addDashboard: () => {
        throw new Error('Backend said 403')
      },
    })
    const { onCreated } = renderCard()

    await user.click(screen.getByRole('button', { name: 'Create dashboard' }))

    // This is ProposalFrame's own inline form error, not a toast, but
    // renderCard also mounts a Toaster whose (empty, in this test) assertive
    // mirror carries role="alert" too, so the query has to pick the one
    // actually carrying the message rather than assume there is only one.
    const alerts = await screen.findAllByRole('alert')
    const banner = alerts.find((el) => /Could not create this dashboard/.test(el.textContent ?? ''))
    expect(banner).toHaveTextContent('Could not create this dashboard. Backend said 403')
    expect(widgets.calls).toEqual([])
    expect(onCreated).not.toHaveBeenCalled()
  })
})
