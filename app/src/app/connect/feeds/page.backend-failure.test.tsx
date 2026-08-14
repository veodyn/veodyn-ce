// An empty state is not an error state. Mock mode resolves from fixtures and
// can never be observed failing, so the hook is pinned instead.
import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/utils'

vi.mock('@/hooks/use-published-feeds', () => ({
  usePublishedFeeds: () => ({ data: undefined, isLoading: false, isError: true, refetch: () => {} }),
}))

// The list navigates to a feed on a row click, so it reads the router, and
// useRouter throws outside an app-router context rather than returning null.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}))

import PublishedFeedsPage from './page'

describe('the published feeds list when the sidecar fails', () => {
  it('says the list could not be read rather than that nothing is published', async () => {
    renderWithProviders(<PublishedFeedsPage />)

    expect(await screen.findByText(/Could not load published feeds\./)).toBeInTheDocument()
    expect(screen.queryByText(/No feeds are published/i)).not.toBeInTheDocument()
  })
})
