import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/features/generated-registry', () => ({ FEATURES: {} }))

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back: vi.fn() }),
}))

import { renderWithProviders, resetStores, signInAsAdmin } from '@/test/utils'
import { useMockDataStore } from '@/stores/mock-data-store'
import EditFeedPage from './page'

afterEach(() => {
  resetStores()
  push.mockClear()
})

const params = Promise.resolve({ slug: 'vehicles-live' })

// The route reads `params` via use(), which suspends on mount even for an
// already-resolved promise, so the render is wrapped in an awaited act() to
// flush that microtask (same idiom as the detail page test).
async function renderPage({ asAdmin = true } = {}) {
  if (asAdmin) signInAsAdmin()
  await act(async () => {
    renderWithProviders(<EditFeedPage params={params} />)
  })
}

// The fixture's newest attempt for vehicles-live is isCurrent; clearing that
// puts the feed in the already-dark state the second test needs.
function goDark() {
  const attempts = useMockDataStore.getState().publishAttempts['vehicles-live']
  useMockDataStore.setState({
    publishAttempts: {
      'vehicles-live': attempts.map((a) => ({ ...a, isCurrent: false })),
    },
  })
}

describe('the published feed edit page', () => {
  it('warns before saving a feed that is currently serving', async () => {
    const user = userEvent.setup()
    await renderPage()

    await user.click(await screen.findByRole('button', { name: 'Save and republish' }))

    expect(await screen.findByText('Take this feed off the air?')).toBeInTheDocument()
    expect(screen.getByText(/off the air until/i)).toBeInTheDocument()
    expect(screen.getByText(/consumers.*nothing/i)).toBeInTheDocument()
    // Nothing has been sent yet: the reader has only been asked.
    expect(push).not.toHaveBeenCalled()
  })

  it('says the save republishes only when there is something to republish', async () => {
    // The label is the one place an admin learns the save also fires an
    // attempt, and it must not promise one on a feed that is already dark.
    await renderPage()
    expect(await screen.findByRole('button', { name: 'Save and republish' })).toBeInTheDocument()

    // Two separate screens, not one tree re-rendering: both are subscribed to
    // the same Zustand store, so the first would follow the second into the
    // dark state and the assertion below would be made against two buttons.
    cleanup()
    resetStores()
    goDark()
    await renderPage()

    expect(await screen.findByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save and republish' })).not.toBeInTheDocument()
  })

  it('saves with no confirm when the feed is already dark', async () => {
    goDark()
    const user = userEvent.setup()
    await renderPage()

    await user.click(await screen.findByRole('button', { name: 'Save' }))

    expect(screen.queryByText('Take this feed off the air?')).not.toBeInTheDocument()
    await waitFor(() => expect(push).toHaveBeenCalledWith('/connect/feeds/vehicles-live'))
  })

  it('fires an attempt immediately on confirming, so the history gains a row without a second press', async () => {
    const user = userEvent.setup()
    await renderPage()
    const before = useMockDataStore.getState().publishAttempts['vehicles-live'].length

    await user.click(await screen.findByRole('button', { name: 'Save and republish' }))
    await screen.findByText('Take this feed off the air?')
    await user.click(screen.getByRole('button', { name: 'Save anyway' }))

    await waitFor(() =>
      expect(useMockDataStore.getState().publishAttempts['vehicles-live']).toHaveLength(before + 1)
    )
  })

  it('keeps the binding source column an edit does not offer to change', async () => {
    // Bindings created by calling the sidecar directly are the premise of this
    // surface, and the endpoint is a whole-binding PUT: a form that re-sent
    // null here would erase the field on the first edit.
    const feeds = useMockDataStore.getState().publishedFeeds
    useMockDataStore.setState({
      publishedFeeds: feeds.map((f) =>
        f.slug === 'vehicles-live' ? { ...f, sourceColumn: 'agency_feed' } : f
      ),
    })
    goDark()
    const user = userEvent.setup()
    await renderPage()

    await user.click(await screen.findByRole('button', { name: 'Save' }))

    await waitFor(() => expect(push).toHaveBeenCalled())
    const saved = useMockDataStore.getState().publishedFeeds.find((f) => f.slug === 'vehicles-live')
    expect(saved?.sourceColumn).toBe('agency_feed')
  })

  it('locks the slug field and says a feed cannot be renamed', async () => {
    await renderPage()

    expect(await screen.findByLabelText('Slug')).toBeDisabled()
    expect(screen.getByText(/cannot be renamed/i)).toBeInTheDocument()
  })

  it('shows a non-admin the arrangement instead of a form that can only fail', async () => {
    await renderPage({ asAdmin: false })

    expect(await screen.findByText(/publishing is administered/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('Slug')).not.toBeInTheDocument()
  })
})
