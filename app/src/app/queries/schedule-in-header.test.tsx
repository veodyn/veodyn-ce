import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockQueries, type MockQuery } from '@/lib/mock-data'
import { buildCurrentUser } from '@/stores/auth-identity'
import { useAuthStore } from '@/stores/auth-store'
import { useMockDataStore } from '@/stores/mock-data-store'
import { renderWithProviders, resetStores } from '@/test/utils'
import QueryViewPage from '@/app/queries/[queryId]/page'

// QuerySourceMenu calls useRouter at the top of its render, and there is no App
// Router mounted under a component test.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

const QUERY_ID = 4242

function seedQuery(overrides: Partial<MockQuery>) {
  const query: MockQuery = {
    ...mockQueries[0],
    id: QUERY_ID,
    name: 'Platform Dwell Time',
    can_edit: true,
    // Nothing here is about results, and a result would only add async work.
    latest_query_data_id: null,
    schedule: null,
    ...overrides,
  }
  useMockDataStore.setState({ queries: [query] })
}

// The route reads its params with `use()`, which suspends, and the query loads
// in a microtask after that. Both are flushed here so every assertion below
// runs against the settled page.
async function renderPage() {
  await act(async () => {
    renderWithProviders(<QueryViewPage params={Promise.resolve({ queryId: String(QUERY_ID) })} />)
  })
}

beforeEach(() => {
  resetStores()
  useAuthStore.setState({ isAuthenticated: true, isLoading: false })
})

afterEach(() => {
  resetStores()
  useMockDataStore.setState({ queries: mockQueries })
})

describe('the refresh schedule in the query header', () => {
  it('names the cadence beside the other header metadata', async () => {
    seedQuery({ schedule: { interval: 900, time: null, day_of_week: null, until: null } })
    await renderPage()

    // The full phrase, not a substring: "Refreshes" alone would also match the
    // Refresh button that sits a few nodes away.
    expect(await screen.findByText('Refreshes every 15 minutes')).toBeInTheDocument()
  })

  it('reads the schedule off the query rather than printing one phrase for all', async () => {
    seedQuery({ schedule: { interval: 86400, time: '06:00', day_of_week: null, until: null } })
    await renderPage()

    expect(await screen.findByText('Refreshes daily at 06:00')).toBeInTheDocument()
    expect(screen.queryByText('Refreshes every 15 minutes')).not.toBeInTheDocument()
  })

  it('adds nothing to the row when the query is not scheduled', async () => {
    seedQuery({ schedule: null })
    await renderPage()

    // The header itself rendered, so the absence below is a real absence.
    expect(await screen.findByText('Platform Dwell Time')).toBeInTheDocument()
    expect(screen.queryByText(/^Refreshes/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Schedule ended/)).not.toBeInTheDocument()
  })

  it('opens the Schedule dialog when the cadence is clicked', async () => {
    const user = userEvent.setup()
    seedQuery({ schedule: { interval: 3600, time: null, day_of_week: null, until: null } })
    await renderPage()

    const control = await screen.findByRole('button', { name: 'Refreshes every hour' })
    // Asserted before the click, so a dialog that was open all along cannot
    // pass this as if the click had done it.
    expect(screen.queryByRole('dialog', { name: 'Schedule Query' })).not.toBeInTheDocument()

    await user.click(control)

    expect(screen.getByRole('dialog', { name: 'Schedule Query' })).toBeInTheDocument()
  })

  it('is plain text, not a control, for someone who cannot edit the query', async () => {
    seedQuery({
      can_edit: false,
      schedule: { interval: 900, time: null, day_of_week: null, until: null },
    })
    await renderPage()

    // Still readable: knowing the query refreshes itself is not an edit right.
    expect(await screen.findByText('Refreshes every 15 minutes')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Refreshes every 15 minutes' })
    ).not.toBeInTheDocument()
  })

  it('stays clickable for an admin, the way the overflow menu does', async () => {
    // query-source-menu gates its own Schedule item on can_edit || isAdmin, and
    // two doors to the same dialog that disagree is a bug report waiting.
    // Built the way the session response builds it. A hand-rolled object cast
    // to CurrentUser has no canEdit method, and query-source-menu calls it, so
    // the cast used to take the whole header down rather than fail an assertion.
    useAuthStore.setState({
      currentUser: buildCurrentUser({
        id: 9,
        name: 'Admin',
        email: 'admin@example.com',
        permissions: ['admin'],
      }),
    })
    seedQuery({
      can_edit: false,
      schedule: { interval: 900, time: null, day_of_week: null, until: null },
    })
    await renderPage()

    expect(
      await screen.findByRole('button', { name: 'Refreshes every 15 minutes' })
    ).toBeInTheDocument()
  })

  it('reports an expired schedule as ended instead of as a live cadence', async () => {
    seedQuery({
      schedule: { interval: 900, time: null, day_of_week: null, until: '2020-01-01' },
    })
    await renderPage()

    expect(await screen.findByText('Schedule ended 01/01/20')).toBeInTheDocument()
    expect(screen.queryByText('Refreshes every 15 minutes')).not.toBeInTheDocument()
  })
})
