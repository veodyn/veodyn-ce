import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/features/generated-registry', () => ({ FEATURES: {} }))

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back: vi.fn() }),
}))

import { renderWithProviders, resetStores, signInAsAdmin } from '@/test/utils'
import { useMockDataStore } from '@/stores/mock-data-store'
import PublishedFeedsPage from './page'

afterEach(() => {
  resetStores()
  push.mockClear()
})

describe('the published feeds list', () => {
  it('lists each feed with its address and standard', async () => {
    renderWithProviders(<PublishedFeedsPage />)

    expect(screen.getByRole('heading', { name: 'Published Feeds' })).toBeInTheDocument()
    expect(await screen.findByText('vehicles-live')).toBeInTheDocument()
    expect(screen.getByText(/GTFS-Realtime/)).toBeInTheDocument()
  })

  it('opens the feed on a row click, since nothing else reaches the detail page', async () => {
    const user = userEvent.setup()
    renderWithProviders(<PublishedFeedsPage />)

    await user.click(await screen.findByText('vehicles-live'))

    expect(push).toHaveBeenCalledWith('/connect/feeds/vehicles-live')
  })

  it('offers publishing only to an administrator, and says so', async () => {
    renderWithProviders(<PublishedFeedsPage />)
    await screen.findByText('vehicles-live')
    expect(screen.queryByRole('link', { name: /publish a feed/i })).not.toBeInTheDocument()
    expect(screen.getByText(/publishing is administered/i)).toBeInTheDocument()

    // Without this, the first render stays mounted (RTL only auto-cleans
    // between `it`s, not within one) and, being subscribed to the same
    // Zustand store, re-renders as admin too the moment signInAsAdmin runs.
    // Two mounted trees both showing the link is not what this test means to
    // exercise: it wants two separate screens, signed out then signed in.
    cleanup()
    resetStores()
    signInAsAdmin()
    renderWithProviders(<PublishedFeedsPage />)
    expect(await screen.findByRole('link', { name: /publish a feed/i })).toBeInTheDocument()
    expect(screen.queryByText(/publishing is administered/i)).not.toBeInTheDocument()
  })

  it('says nothing is published rather than showing an empty table', async () => {
    useMockDataStore.setState({ publishedFeeds: [] })
    renderWithProviders(<PublishedFeedsPage />)

    expect(await screen.findByText(/No feeds are published/i)).toBeInTheDocument()
  })
})
