import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/features/generated-registry', () => ({ FEATURES: {} }))

import { renderWithProviders, resetStores, signInAsAdmin } from '@/test/utils'
import { mockQueries } from '@/lib/mock-data'
import { useMockDataStore } from '@/stores/mock-data-store'
import FeedDetailPage from './page'

afterEach(() => {
  resetStores()
  useMockDataStore.setState({ queries: mockQueries })
})

const params = Promise.resolve({ slug: 'vehicles-live' })

// vehicles-live binds query 1, whose fixture `latest_query_data_id` (101) sits
// well below the currently-serving attempt's `queryResultId` (501). The stale-
// result guard reads that as "nothing new" and withholds the publish control,
// so any test that wants the control present has to give the query a result
// id newer than 501 first.
function seedFreshQueryResult(latestId: number) {
  useMockDataStore.setState({
    queries: mockQueries.map((q) => (q.id === 1 ? { ...q, latest_query_data_id: latestId } : q)),
  })
}

// The route reads `params` via use(), which suspends on mount even for an
// already-resolved promise, so the render is wrapped in an awaited act() to
// flush that microtask (same idiom as the destinations and data-sources
// detail-page tests).
async function renderPage() {
  let result!: ReturnType<typeof renderWithProviders>
  await act(async () => {
    result = renderWithProviders(<FeedDetailPage params={params} />)
  })
  return result
}

describe('the published feed detail page', () => {
  it('reports what is serving, from the attempt record', async () => {
    await renderPage()

    expect(await screen.findByText('Serving')).toBeInTheDocument()
  })

  it('never claims mapping validity on a read', async () => {
    // Pinned to the value that would actually leak. Both read endpoints
    // hard-code bindingState to `unknown`, so `unknown` is the literal this
    // page would print the moment anything rendered the field, and it is the
    // only string that can catch that. An earlier spelling of this test looked
    // for "mapping ok", which no implementation of this page would ever emit,
    // so it passed whatever BindingSummary did.
    const feed = useMockDataStore.getState().publishedFeeds.find((f) => f.slug === 'vehicles-live')
    expect(feed?.bindingState).toBe('unknown')

    const { container } = await renderPage()

    await screen.findByText('Serving')
    expect(container.textContent).not.toContain('unknown')
  })

  it('calls a published attempt that is no longer current "Not serving", not "Failed"', async () => {
    // What an edit or a delete leaves behind: the attempt published, and then
    // take_the_feed_off_the_air cleared the pointer under it. That is not a
    // failure, and the history three lines below still says "Published".
    useMockDataStore.setState({
      publishAttempts: {
        'vehicles-live': [
          {
            attemptId: 9,
            bindingRevision: 3,
            queryResultId: 700,
            decision: 'published',
            reason: '',
            findings: [],
            enabledRules: ['E003'],
            isCurrent: false,
            createdAt: new Date().toISOString(),
          },
        ],
      },
    })
    await renderPage()

    expect(await screen.findByText('Not serving')).toBeInTheDocument()
    expect(screen.queryByText('Failed')).not.toBeInTheDocument()
    expect(screen.getByText('Published')).toBeInTheDocument()
  })

  it('groups a blocked attempt findings by rule and counts the occurrences', async () => {
    await renderPage()

    expect(await screen.findByText(/GTFS-rt trip_id does not exist/)).toBeInTheDocument()
    // Two occurrences of one rule collapse into one row, not two.
    expect(screen.getAllByText(/GTFS-rt trip_id does not exist/)).toHaveLength(1)
    expect(screen.getByText(/2 occurrences/i)).toBeInTheDocument()
  })

  it('shows a failed attempt reason and no findings list', async () => {
    useMockDataStore.setState({
      publishAttempts: {
        'vehicles-live': [
          {
            attemptId: 9,
            bindingRevision: 3,
            queryResultId: 700,
            decision: 'failed',
            reason: 'no feed validator is configured for this deployment',
            findings: [],
            enabledRules: [],
            isCurrent: false,
            createdAt: new Date().toISOString(),
          },
        ],
      },
    })
    await renderPage()

    expect(await screen.findByText(/no feed validator is configured/)).toBeInTheDocument()
    expect(screen.queryByText(/occurrences/i)).not.toBeInTheDocument()
  })

  it('offers publishing only to an administrator', async () => {
    seedFreshQueryResult(600)
    await renderPage()
    await screen.findByText('Serving')
    expect(screen.queryByRole('button', { name: /publish now/i })).not.toBeInTheDocument()

    resetStores()
    seedFreshQueryResult(600)
    signInAsAdmin()
    await renderPage()
    expect(await screen.findByRole('button', { name: /publish now/i })).toBeInTheDocument()
  })

  it('records an attempt when publish is pressed', async () => {
    seedFreshQueryResult(600)
    signInAsAdmin()
    const user = userEvent.setup()
    await renderPage()

    await user.click(await screen.findByRole('button', { name: /publish now/i }))

    await screen.findByText(/Serving/)
    expect(useMockDataStore.getState().publishAttempts['vehicles-live']).toHaveLength(3)
  })

  it('withholds the publish control when the query has produced nothing new', async () => {
    signInAsAdmin()
    // Matches the isCurrent attempt's own queryResultId (501) exactly: the
    // engine's rule is "not newer than", and equal is the clearest case of that.
    seedFreshQueryResult(501)
    await renderPage()

    await screen.findByText('Serving')
    // useQueryResultColumns resolves after mount, on its own render pass, so
    // the explanatory line replaces the button asynchronously rather than
    // being there from the first paint.
    expect(await screen.findByText(/produced nothing new/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /publish now/i })).not.toBeInTheDocument()
  })

  it('asks for confirmation before deleting, naming what consumers lose', async () => {
    signInAsAdmin()
    const user = userEvent.setup()
    await renderPage()

    await user.click(await screen.findByRole('button', { name: 'Delete' }))

    expect(await screen.findByText(/consumers.*start getting nothing/i)).toBeInTheDocument()
    expect(screen.getByText(/indistinguishable from one that never existed/i)).toBeInTheDocument()
  })
})
