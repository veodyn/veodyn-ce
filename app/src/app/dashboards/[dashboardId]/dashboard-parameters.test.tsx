/**
 * The dashboard renders one control per parameter its widgets promote, and
 * applying a value reaches the widgets underneath.
 *
 * The add-widget dialog has always written `options.parameterMappings`; until
 * now nothing read them, so a dashboard with parameters offered no way to set
 * them and every widget ran with none supplied.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockDashboards, type MockDashboard, type MockDashboardWidget } from '@/lib/mock-data'
import { useAuthStore } from '@/stores/auth-store'
import { useMockDataStore } from '@/stores/mock-data-store'
import { renderWithProviders, resetStores } from '@/test/utils'
import DashboardViewPage from '@/app/dashboards/[dashboardId]/page'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

const DASHBOARD_ID = 8282

function parameterisedWidget(): MockDashboardWidget {
  return {
    id: 1,
    dashboard_id: DASHBOARD_ID,
    width: 1,
    options: {
      position: { col: 0, row: 0, sizeX: 3, sizeY: 5 },
      parameterMappings: {
        city: { type: 'dashboard-add-new', mapTo: 'region', title: 'Region' },
        note: { type: 'widget-level' },
      },
    },
    visualization: {
      id: 90,
      type: 'TABLE',
      name: 'T',
      description: '',
      options: {},
      query: {
        id: 1,
        name: 'Cities',
        latest_query_data_id: null,
        options: {
          parameters: [
            { name: 'city', title: 'City', type: 'enum', value: 'A', enumOptions: 'A\nB\nC' },
            { name: 'note', title: 'Note', type: 'text', value: 'x' },
          ],
        },
      },
    },
  }
}

function seedDashboard(widgets: MockDashboardWidget[]) {
  const dashboard: MockDashboard = {
    ...mockDashboards[0],
    id: DASHBOARD_ID,
    name: 'Transit Overview',
    can_edit: true,
    widgets,
    tags: [],
  }
  useMockDataStore.setState({ dashboards: [dashboard] })
}

async function renderPage() {
  await act(async () => {
    renderWithProviders(
      <DashboardViewPage params={Promise.resolve({ dashboardId: String(DASHBOARD_ID) })} />
    )
  })
}

beforeEach(() => {
  resetStores()
  useAuthStore.setState({ isAuthenticated: true, isLoading: false })
})

afterEach(() => {
  resetStores()
  useMockDataStore.setState({ dashboards: mockDashboards })
})

describe('a dashboard whose widgets promote parameters', () => {
  it('renders one control for the promoted parameter', async () => {
    seedDashboard([parameterisedWidget()])
    await renderPage()

    expect(await screen.findByLabelText('Region')).toBeInTheDocument()
  })

  // widget-level stays private to the widget, so it must not appear up here.
  it('leaves a widget-level parameter off the dashboard', async () => {
    seedDashboard([parameterisedWidget()])
    await renderPage()

    await screen.findByLabelText('Region')
    expect(screen.queryByLabelText('Note')).not.toBeInTheDocument()
  })

  it('shows no bar at all when nothing is promoted', async () => {
    const widget = parameterisedWidget()
    widget.options.parameterMappings = { city: { type: 'static-value', value: 'A' } }
    seedDashboard([widget])
    await renderPage()

    expect(screen.queryByRole('button', { name: 'Apply Changes' })).not.toBeInTheDocument()
  })

  it('applies a chosen value', async () => {
    const user = userEvent.setup()
    seedDashboard([parameterisedWidget()])
    await renderPage()

    await user.click(await screen.findByLabelText('Region'))
    await act(async () => {
      await user.click(await screen.findByRole('option', { name: 'B' }))
    })
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Apply Changes' }))
    })

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
