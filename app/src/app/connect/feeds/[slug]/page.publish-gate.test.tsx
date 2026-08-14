// The publish control fails closed. Mock mode's result lookup always resolves,
// so the states this guards (pending, errored, no cached result) can only be
// observed by pinning the hook.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'

vi.mock('@/features/generated-registry', () => ({ FEATURES: {} }))

// A settled lookup with a newer result: what the tests below deviate from, and
// what the mock is put back to before `resetStores` re-renders a tree that has
// not been unmounted yet.
const SETTLED = { data: { resultId: 900, columns: [] }, isPending: false, isError: false }
const lookup = vi.fn(() => SETTLED as unknown)
vi.mock('@/hooks/use-published-feeds', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/use-published-feeds')>(
    '@/hooks/use-published-feeds'
  )
  return { ...actual, useQueryResultColumns: () => lookup() }
})

import { renderWithProviders, resetStores, signInAsAdmin } from '@/test/utils'
import FeedDetailPage from './page'

afterEach(() => {
  lookup.mockReturnValue(SETTLED)
  resetStores()
})

const params = Promise.resolve({ slug: 'vehicles-live' })

async function renderPage() {
  signInAsAdmin()
  await act(async () => {
    renderWithProviders(<FeedDetailPage params={params} />)
  })
  await screen.findByText('Serving')
}

const publishButton = () => screen.queryByRole('button', { name: /publish now/i })

describe('the publish control on a feed detail page', () => {
  it('is offered once a newer result is known to exist', async () => {
    // The control. Without it the three refusals below could all be passing
    // because the button is never rendered at all.
    lookup.mockReturnValue(SETTLED)
    await renderPage()

    expect(publishButton()).toBeInTheDocument()
  })

  it('is withheld while the result lookup has not finished', async () => {
    lookup.mockReturnValue({ data: undefined, isPending: true, isError: false })
    await renderPage()

    expect(publishButton()).not.toBeInTheDocument()
    expect(screen.getByText(/checking whether this query has a result newer/i)).toBeInTheDocument()
    // Not the stale-result sentence: nothing has been compared yet, so saying
    // the query produced nothing new would be a claim this page cannot make.
    expect(screen.queryByText(/produced nothing new/i)).not.toBeInTheDocument()
  })

  it('is withheld when the result lookup failed', async () => {
    lookup.mockReturnValue({ data: undefined, isPending: false, isError: true })
    await renderPage()

    expect(publishButton()).not.toBeInTheDocument()
    expect(screen.getByText(/could not be read/i)).toBeInTheDocument()
    expect(screen.queryByText(/produced nothing new/i)).not.toBeInTheDocument()
  })

  it('is withheld when the query has no cached result at all', async () => {
    lookup.mockReturnValue({ data: { resultId: null, columns: [] }, isPending: false, isError: false })
    await renderPage()

    expect(publishButton()).not.toBeInTheDocument()
    expect(screen.getByText(/no cached result/i)).toBeInTheDocument()
  })
})
