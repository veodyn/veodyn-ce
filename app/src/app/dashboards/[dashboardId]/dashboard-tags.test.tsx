import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockDashboards, type MockDashboard } from '@/lib/mock-data'
import { useAuthStore } from '@/stores/auth-store'
import { useMockDataStore } from '@/stores/mock-data-store'
import { renderWithProviders, resetStores } from '@/test/utils'
import DashboardViewPage from '@/app/dashboards/[dashboardId]/page'

// The page routes to the new report after "Promote to report", so it calls
// useRouter on every render and needs an app router in the test environment.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

const DASHBOARD_ID = 8181

function seedDashboard(overrides: Partial<MockDashboard>) {
  const dashboard: MockDashboard = {
    ...mockDashboards[0],
    id: DASHBOARD_ID,
    name: 'Transit Overview',
    can_edit: true,
    // No widgets: nothing here is about the grid, and each widget pulls a query
    // result behind it.
    widgets: [],
    tags: [],
    ...overrides,
  }
  useMockDataStore.setState({ dashboards: [dashboard] })
}

/** What the write left behind, rather than what the component claims it sent. */
function storedTags(): string[] | undefined {
  return useMockDataStore.getState().dashboards.find((d) => d.id === DASHBOARD_ID)?.tags
}

async function renderPage() {
  await act(async () => {
    renderWithProviders(
      <DashboardViewPage params={Promise.resolve({ dashboardId: String(DASHBOARD_ID) })} />
    )
  })
}

async function addTag(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(await screen.findByRole('button', { name: 'Add Tag' }))
  const input = await screen.findByRole('combobox', { name: 'Add a tag' })
  await user.type(input, text)
  await act(async () => {
    await user.keyboard('{Enter}')
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

describe('tagging a dashboard', () => {
  // Tagging used to require entering Edit mode, which is a widget-arranging
  // session. Labelling a dashboard is not part of its layout, and putting the
  // one behind the other is why almost nothing carried tags.
  it('offers the add control without entering Edit mode', async () => {
    seedDashboard({ tags: ['rail'] })
    await renderPage()

    // The Edit button being on screen is the proof that this is the view mode:
    // in an edit session the toolbar shows "Done Editing" instead. Without this
    // the test would pass against a page that had silently started in Edit.
    expect(await screen.findByRole('button', { name: /^Edit$/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Done Editing/ })).not.toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'Add Tag' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove tag rail' })).toBeInTheDocument()
  })

  it('saves the whole array from view mode', async () => {
    const user = userEvent.setup()
    seedDashboard({ tags: ['rail'] })
    await renderPage()

    await addTag(user, 'ridership')

    expect(storedTags()).toEqual(['rail', 'ridership'])
  })

  // The regression that matters most: `domain:` tags build the domain hubs, so
  // a save assembled from the visible chips alone deletes one every time
  // somebody adds an unrelated label.
  it('keeps a domain tag through a round trip that adds an unrelated tag', async () => {
    const user = userEvent.setup()
    seedDashboard({ tags: ['domain:rail', 'ridership'] })
    await renderPage()

    expect(screen.queryByText('domain:rail')).not.toBeInTheDocument()

    await addTag(user, 'boardings')

    expect(storedTags()).toEqual(['domain:rail', 'ridership', 'boardings'])
  })

  it('is read only for someone who cannot edit the dashboard', async () => {
    seedDashboard({ tags: ['rail'], can_edit: false })
    await renderPage()

    expect(
      await screen.findByRole('link', { name: 'Search for everything tagged rail' })
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add Tag' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove tag rail' })).not.toBeInTheDocument()
  })
})
