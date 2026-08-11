// The defect this file guards was live on stage: /api/feeds answered 404, the
// error left `data` undefined, and the page rendered "0 feeds. No feeds
// configured." A monitoring page that reports its own outage as "nothing to
// monitor" is the failure nobody files, because it looks like the truth.
//
// The hook is pinned rather than driven through msw because mock mode resolves
// from the fixture store and can never be observed failing, and real-API mode
// would route this page's other hook at a backend this file is not about.
import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/utils'

vi.mock('@/hooks/use-feeds', () => ({
  useFeeds: () => ({ data: undefined, isLoading: false, isError: true }),
}))

import FeedHealthPage from './page'

describe('FeedHealthPage when the feed service fails', () => {
  it('says the service is unavailable rather than that there are no feeds', async () => {
    renderWithProviders(<FeedHealthPage />)

    expect(
      await screen.findByText(/Unable to load feed health\. The feed service may be unavailable\./)
    ).toBeInTheDocument()
    // The whole point: the empty state must not stand in for the failure.
    expect(screen.queryByText('No feeds configured.')).not.toBeInTheDocument()
  })

  it('does not offer a search box over a list it could not load', async () => {
    renderWithProviders(<FeedHealthPage />)

    await screen.findByText(/may be unavailable/)
    // A "0 feeds" counter and a filter box over nothing are what made the
    // failure read as an answer.
    expect(screen.queryByLabelText('Search feeds')).not.toBeInTheDocument()
  })
})
