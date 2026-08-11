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
    tags: [],
    ...overrides,
  }
  useMockDataStore.setState({ queries: [query] })
}

/**
 * What the write actually left behind, rather than what the component claims it
 * sent. The real `useUpdateQuery` runs here, so this is the array Redash would
 * have been given: a save that dropped a tag on the way through shows up as a
 * missing entry, not as a passing spy call.
 */
function storedTags(): string[] | undefined {
  return useMockDataStore.getState().queries.find((q) => q.id === QUERY_ID)?.tags
}

async function renderPage() {
  await act(async () => {
    renderWithProviders(<QueryViewPage params={Promise.resolve({ queryId: String(QUERY_ID) })} />)
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
  useMockDataStore.setState({ queries: mockQueries })
})

describe('tagging a query from its detail page', () => {
  it('saves the whole array, not just the tag that was added', async () => {
    const user = userEvent.setup()
    seedQuery({ tags: ['rail'] })
    await renderPage()

    await addTag(user, 'ridership')

    // An implementation that sent only the new tag leaves ['ridership'] here,
    // which is a silent deletion of every tag the query already carried.
    expect(storedTags()).toEqual(['rail', 'ridership'])
  })

  it('normalizes what was typed rather than storing it verbatim', async () => {
    const user = userEvent.setup()
    seedQuery({ tags: [] })
    await renderPage()

    await addTag(user, '  Peak   Ridership  ')

    // Matching is exact and case sensitive, so `Peak   Ridership` stored raw is
    // a tag nothing else will ever match.
    expect(storedTags()).toEqual(['peak ridership'])
  })

  // The regression that matters most: `domain:` tags build the domain hubs, and
  // a save assembled from the visible chips alone would delete one every time
  // somebody added an unrelated label.
  it('keeps a domain tag through a round trip that adds an unrelated tag', async () => {
    const user = userEvent.setup()
    seedQuery({ tags: ['domain:rail', 'ridership'] })
    await renderPage()

    // It is not on screen, so it can only survive by being carried through the
    // array rather than by being re-added from what was rendered.
    expect(screen.queryByText('domain:rail')).not.toBeInTheDocument()

    await addTag(user, 'boardings')

    expect(storedTags()).toEqual(['domain:rail', 'ridership', 'boardings'])
  })

  it('keeps a domain tag when a visible tag is removed', async () => {
    const user = userEvent.setup()
    seedQuery({ tags: ['domain:rail', 'ridership'] })
    await renderPage()

    await act(async () => {
      await user.click(await screen.findByRole('button', { name: 'Remove tag ridership' }))
    })

    expect(storedTags()).toEqual(['domain:rail'])
  })

  it('shows the new tag without waiting for the write to come back', async () => {
    const user = userEvent.setup()
    seedQuery({ tags: [] })
    await renderPage()

    await addTag(user, 'ridership')

    expect(await screen.findByText('ridership')).toBeInTheDocument()
  })

  it('is read only for someone who cannot edit the query', async () => {
    seedQuery({ tags: ['rail'], can_edit: false })
    await renderPage()

    // Still readable and still a way to pivot: seeing a tag is not an edit
    // right. What is gone is every affordance that would write.
    expect(
      await screen.findByRole('link', { name: 'Search for everything tagged rail' })
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add Tag' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove tag rail' })).not.toBeInTheDocument()
  })

  it('stays editable for an admin, the way the overflow menu does', async () => {
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
    seedQuery({ tags: ['rail'], can_edit: false })
    await renderPage()

    expect(await screen.findByRole('button', { name: 'Add Tag' })).toBeInTheDocument()
  })
})
