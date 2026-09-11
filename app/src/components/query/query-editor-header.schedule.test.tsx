// The editor could only tell you whether a query refreshes itself by way of
// opening the overflow menu, so the answer to "is this scheduled" cost the same
// gesture as changing it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockQueries, type MockQuery } from '@/lib/mock-data'
import { useAuthStore } from '@/stores/auth-store'
import { useMockDataStore } from '@/stores/mock-data-store'
import { renderWithProviders, resetStores } from '@/test/utils'
import { QueryEditorHeader } from './query-editor-header'

// A saved query renders QuerySourceMenu, which calls useRouter.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/queries/7',
}))

const QUERY_ID = 7
const noop = () => {}

function seedQuery(overrides: Partial<MockQuery>): MockQuery {
  const query: MockQuery = {
    ...mockQueries[0],
    id: QUERY_ID,
    name: 'Rail boardings',
    can_edit: true,
    latest_query_data_id: null,
    schedule: null,
    tags: [],
    ...overrides,
  }
  useMockDataStore.setState({ queries: [query] })
  return query
}

function renderHeader(query: MockQuery | null, onOpenSchedule = noop, queryId?: number) {
  return renderWithProviders(
    <QueryEditorHeader
      existingQuery={query}
      queryId={queryId ?? (query ? QUERY_ID : undefined)}
      isDirty={false}
      onOpenSchedule={onOpenSchedule}
      onOpenApiKey={noop}
      onOpenAddToDashboard={noop}
      onOpenPermissions={noop}
    />
  )
}

beforeEach(() => {
  resetStores()
  useAuthStore.setState({ isAuthenticated: true, isLoading: false })
})

afterEach(() => resetStores())

describe('the refresh schedule in the editor header', () => {
  it('names the cadence of a scheduled query', async () => {
    renderHeader(seedQuery({ schedule: { interval: 900, time: null, day_of_week: null, until: null } }))

    expect(await screen.findByText('Refreshes every 15 minutes')).toBeInTheDocument()
  })

  it('offers to set one when the query has no schedule', async () => {
    const onOpenSchedule = vi.fn()
    const user = userEvent.setup()
    renderHeader(seedQuery({ schedule: null }), onOpenSchedule)

    await user.click(await screen.findByRole('button', { name: 'No refresh schedule' }))

    // The same dialog the overflow menu opens, opened by the page that owns it.
    expect(onOpenSchedule).toHaveBeenCalledOnce()
  })

  it('says nothing about a query that has not been saved yet', () => {
    // There is no id to write a schedule to, so the offer would go nowhere.
    renderHeader(null, noop, undefined)

    expect(screen.queryByText('No refresh schedule')).not.toBeInTheDocument()
  })

  it('is plain text for someone who cannot edit the query', async () => {
    renderHeader(
      seedQuery({
        can_edit: false,
        schedule: { interval: 3600, time: null, day_of_week: null, until: null },
      })
    )

    expect(await screen.findByText('Refreshes every hour')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Refreshes every hour' })).not.toBeInTheDocument()
  })
})
