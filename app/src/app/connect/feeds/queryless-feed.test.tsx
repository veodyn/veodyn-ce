import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

vi.mock('@/features/generated-registry', () => ({ FEATURES: {} }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}))

import { renderWithProviders, resetStores, signInAsAdmin } from '@/test/utils'
import { useMockDataStore } from '@/stores/mock-data-store'
import { useQueryResultColumns } from '@/hooks/use-published-feeds'
import type { PublishAttempt, PublishedFeed } from '@/types/published-feed'
import PublishedFeedsPage from './page'
import FeedDetailPage from './[slug]/page'

const QUERYLESS: PublishedFeed = {
  slug: 'service-alerts',
  queryId: null,
  standard: 'gtfs-rt',
  version: '2.0',
  entity: 'vehicle_positions',
  staticGtfsRef: 'https://example.org/gtfs.zip',
  systemInfo: null,
  sourceColumn: null,
  columnMap: {},
  onError: 'block',
  lastGoodMaxAgeSeconds: null,
  retireOnFailure: false,
  visibility: 'private',
  revision: 1,
  bindingState: 'unknown',
}

const SERVING: PublishAttempt = {
  attemptId: 1,
  bindingRevision: 1,
  queryResultId: null,
  decision: 'published',
  reason: '',
  findings: [],
  enabledRules: ['E003'],
  isCurrent: true,
  createdAt: '2026-08-27T10:00:00Z',
}

function onlyTheQuerylessFeed() {
  useMockDataStore.setState({
    publishedFeeds: [QUERYLESS],
    publishAttempts: { 'service-alerts': [SERVING] },
  })
}

afterEach(resetStores)

describe('a published feed with no query behind it', () => {
  it('names its source in the list rather than rendering a null', async () => {
    onlyTheQuerylessFeed()

    renderWithProviders(<PublishedFeedsPage />)

    expect(await screen.findByText('service-alerts')).toBeInTheDocument()
    expect(screen.getByText('no query behind it')).toBeInTheDocument()
    expect(screen.queryByText(/query null/)).not.toBeInTheDocument()
  })

  it('says the binding has no query rather than putting null in the summary', async () => {
    onlyTheQuerylessFeed()
    signInAsAdmin()

    await act(async () => {
      renderWithProviders(<FeedDetailPage params={Promise.resolve({ slug: 'service-alerts' })} />)
    })

    const query = await screen.findByText('Query')
    expect(query.parentElement).toHaveTextContent('none')
    expect(query.parentElement).not.toHaveTextContent('null')
  })

  it('withholds the publish control and says why, without claiming a lookup is running', async () => {
    onlyTheQuerylessFeed()
    signInAsAdmin()

    await act(async () => {
      renderWithProviders(<FeedDetailPage params={Promise.resolve({ slug: 'service-alerts' })} />)
    })

    await screen.findByText('Serving')
    expect(screen.queryByRole('button', { name: /publish now/i })).not.toBeInTheDocument()
    expect(screen.getByText(/no query behind it/i)).toBeInTheDocument()
    expect(screen.queryByText(/checking whether this query has a result newer/i)).not.toBeInTheDocument()
  })
})

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('the query result lookup', () => {
  it('does not fire for a feed with no query id', () => {
    const { result } = renderHook(() => useQueryResultColumns(null), { wrapper })

    expect(result.current.fetchStatus).toBe('idle')
    expect(result.current.data).toBeUndefined()
  })

  it('still fires for a query-backed feed', async () => {
    const { result } = renderHook(() => useQueryResultColumns(1), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.resultId).not.toBeUndefined()
  })
})
