import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockQueries, type MockQuery } from '@/lib/mock-data'
import { buildCurrentUser } from '@/stores/auth-identity'
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
  // The header writes through the real useUpdateQuery, which lands here.
  useMockDataStore.setState({ queries: [query] })
  return query
}

/** What the write left behind, rather than what the component claims it sent. */
function storedTags(): string[] | undefined {
  return useMockDataStore.getState().queries.find((q) => q.id === QUERY_ID)?.tags
}

function renderHeader(existingQuery: MockQuery | null, queryId?: number) {
  return renderWithProviders(
    <QueryEditorHeader
      existingQuery={existingQuery}
      queryId={queryId}
      isDirty={false}
      onOpenSchedule={noop}
      onOpenApiKey={noop}
      onOpenAddToDashboard={noop}
      onOpenPermissions={noop}
    />
  )
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

describe('tagging from the query editor header', () => {
  it('saves the whole array, not just the tag that was added', async () => {
    const user = userEvent.setup()
    const query = seedQuery({ tags: ['rail'] })
    renderHeader(query, QUERY_ID)

    await addTag(user, 'ridership')

    expect(storedTags()).toEqual(['rail', 'ridership'])
  })

  // The same regression the detail page guards: the editor is the other surface
  // that can write a query's tags, so a hub deleted from here is just as gone.
  it('keeps a domain tag through a round trip that adds an unrelated tag', async () => {
    const user = userEvent.setup()
    const query = seedQuery({ tags: ['domain:rail', 'ridership'] })
    renderHeader(query, QUERY_ID)

    expect(screen.queryByText('domain:rail')).not.toBeInTheDocument()

    await addTag(user, 'boardings')

    expect(storedTags()).toEqual(['domain:rail', 'ridership', 'boardings'])
  })

  it('is read only for someone who cannot edit the query', async () => {
    const query = seedQuery({ tags: ['rail'], can_edit: false })
    renderHeader(query, QUERY_ID)

    expect(
      screen.getByRole('link', { name: 'Search for everything tagged rail' })
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add Tag' })).not.toBeInTheDocument()
  })

  it('stays editable for an admin', async () => {
    // Built the way the session response builds it. A hand-rolled object cast
    // to CurrentUser has no canEdit method, and the source menu in this header
    // calls it, so the cast took the whole header down rather than fail here.
    useAuthStore.setState({
      currentUser: buildCurrentUser({
        id: 9,
        name: 'Admin',
        email: 'admin@example.com',
        permissions: ['admin'],
      }),
    })
    const query = seedQuery({ tags: ['rail'], can_edit: false })
    renderHeader(query, QUERY_ID)

    expect(screen.getByRole('button', { name: 'Add Tag' })).toBeInTheDocument()
  })

  // There is no id to POST to before the first save, so an add control here
  // would be a button whose write goes nowhere.
  it('leaves tags read only on a query that has not been saved yet', () => {
    const query = seedQuery({ tags: ['rail'] })
    renderHeader(query, undefined)

    expect(screen.queryByRole('button', { name: 'Add Tag' })).not.toBeInTheDocument()
  })
})
