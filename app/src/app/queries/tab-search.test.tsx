import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfigProvider } from '@/components/config/config-provider'
import { NEUTRAL_CONFIG, toClientConfig } from '@/lib/config-schema'
import { mockQueries } from '@/lib/mock-data'
import { useMockDataStore } from '@/stores/mock-data-store'
import { renderWithProviders, resetStores } from '@/test/utils'
import QueriesPage from '@/app/queries/page'

// The search box used to work on the All tab alone.
//
// Only `useAllQueries` accepted a term. `useMyQueries`, `useFavoriteQueries` and
// `useArchivedQueries` took no arguments, so on three of four tabs the field
// accepted input, showed a clear button and changed nothing, while the count
// beside it kept reporting the unfiltered total. It looked like a dead input
// rather than a missing argument, which is why the All tab passing was enough to
// hide it.
//
// Driven through the Archive tab because it is the tab whose contents are
// reachable from nowhere else, so a search that silently ignores you there is
// the most expensive instance of the bug.

let tab = 'archive'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(`tab=${tab}`),
}))

const archived = ['Rail punctuality', 'Rail crowding', 'Bikeshare docks'].map((name, i) => ({
  ...mockQueries[0],
  id: 2000 + i,
  name,
  description: '',
  is_archived: true,
  is_draft: false,
}))

function renderQueriesPage() {
  return renderWithProviders(
    <ConfigProvider value={{ ...toClientConfig(NEUTRAL_CONFIG), ai: { enabled: false } }}>
      <QueriesPage />
    </ConfigProvider>
  )
}

beforeEach(() => {
  tab = 'archive'
  useMockDataStore.setState({ queries: archived })
})

afterEach(() => resetStores())

describe('the library search box on every tab', () => {
  it('narrows the Archive tab, which used to ignore the term entirely', async () => {
    const user = userEvent.setup()
    renderQueriesPage()

    // Positive control: all three are listed before anything is typed, so a
    // later assertion of "one row" cannot pass because the list never rendered.
    expect(await screen.findByText('Rail punctuality')).toBeInTheDocument()
    expect(screen.getByText('Rail crowding')).toBeInTheDocument()
    expect(screen.getByText('Bikeshare docks')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Search queries'), 'bikeshare')

    await waitFor(() => {
      expect(screen.queryByText('Rail punctuality')).not.toBeInTheDocument()
    })
    expect(screen.queryByText('Rail crowding')).not.toBeInTheDocument()
    expect(screen.getByText('Bikeshare docks')).toBeInTheDocument()
  })

  it('reports the narrowed count, not the unfiltered total', async () => {
    const user = userEvent.setup()
    renderQueriesPage()

    await screen.findByText('Rail punctuality')
    await user.type(screen.getByLabelText('Search queries'), 'rail')

    // The count beside the box was the specific tell that the term was being
    // dropped: three rows filtered to two while it still read three.
    await waitFor(() => {
      expect(screen.getByText(/2 queries/i)).toBeInTheDocument()
    })
  })

  it('matches a term that appears only in the description', async () => {
    const user = userEvent.setup()
    useMockDataStore.setState({
      queries: [
        { ...archived[0], description: 'on-time performance for the blue line' },
        archived[1],
      ],
    })
    renderQueriesPage()

    await screen.findByText('Rail punctuality')
    await user.type(screen.getByLabelText('Search queries'), 'blue line')

    await waitFor(() => {
      expect(screen.queryByText('Rail crowding')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Rail punctuality')).toBeInTheDocument()
  })

  it('still narrows the My tab', async () => {
    tab = 'my'
    const user = userEvent.setup()
    // useMyQueries filters on the signed-in id, and resetStores leaves nobody
    // signed in, so the rows have to belong to whoever that is: undefined.
    useMockDataStore.setState({
      queries: archived.map((q) => ({
        ...q,
        is_archived: false,
        user: { ...q.user, id: undefined as unknown as number },
      })),
    })
    renderQueriesPage()

    expect(await screen.findByText('Rail punctuality')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Search queries'), 'bikeshare')

    await waitFor(() => {
      expect(screen.queryByText('Rail punctuality')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Bikeshare docks')).toBeInTheDocument()
  })
})
