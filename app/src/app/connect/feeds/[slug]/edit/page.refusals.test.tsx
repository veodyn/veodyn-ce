// `update_feed` runs the same `_check` `create_feed` does and answers with the
// same SLUG_TAKEN, QUERY_UNREADABLE and BINDING_INVALID refusals, so they have
// to land at the field that caused them here too and not in the page banner.
//
// Mock mode's store never refuses an update, so the mutation is pinned, the
// same arrangement the create page's test uses.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/features/generated-registry', () => ({ FEATURES: {} }))

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back: vi.fn() }),
}))

const mutateAsync = vi.fn()
vi.mock('@/hooks/use-published-feeds', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/use-published-feeds')>(
    '@/hooks/use-published-feeds'
  )
  return { ...actual, useUpdatePublishedFeed: () => ({ mutateAsync, isPending: false }) }
})

import { renderWithProviders, resetStores, signInAsAdmin } from '@/test/utils'
import { AppError, ErrorIds } from '@/lib/errorIds'
import { useMockDataStore } from '@/stores/mock-data-store'
import EditFeedPage from './page'

afterEach(() => {
  resetStores()
  mutateAsync.mockReset()
  push.mockClear()
})

const params = Promise.resolve({ slug: 'vehicles-live' })

// Already dark, so Save submits straight through instead of stopping at the
// going-dark confirm: what this file is about is where the refusal lands.
async function saveAndBeRefused(error: unknown) {
  const attempts = useMockDataStore.getState().publishAttempts['vehicles-live']
  useMockDataStore.setState({
    publishAttempts: { 'vehicles-live': attempts.map((a) => ({ ...a, isCurrent: false })) },
  })
  mutateAsync.mockRejectedValueOnce(error)
  signInAsAdmin()
  const user = userEvent.setup()
  await act(async () => {
    renderWithProviders(<EditFeedPage params={params} />)
  })
  await user.click(await screen.findByRole('button', { name: 'Save' }))
}

describe('a refused save on the edit page', () => {
  it('puts a slug collision on the slug field', async () => {
    await saveAndBeRefused(
      new AppError(ErrorIds.PUBLISHED_FEED_REQUEST_FAILED, "a feed is already published at 'vehicles-live'", {
        status: 409,
        errorId: 'VEODYN_PUBLISHED_FEED_SLUG_TAKEN',
      })
    )

    const slugRow = screen.getByLabelText('Slug').closest('div') as HTMLElement
    expect(await within(slugRow).findByRole('alert')).toHaveTextContent(/already published/i)
    expect(push).not.toHaveBeenCalled()
  })

  it('puts a binding-invalid problem on its own mapping row', async () => {
    await saveAndBeRefused(
      new AppError(
        ErrorIds.PUBLISHED_FEED_REQUEST_FAILED,
        "the column map cannot produce this feed: required field 'latitude' is not mapped",
        { status: 422, errorId: 'VEODYN_PUBLISHED_FEED_BINDING_INVALID' }
      )
    )

    const latitudeRow = (await screen.findByText('latitude')).closest('tr') as HTMLElement
    expect(within(latitudeRow).getByRole('alert')).toHaveTextContent("'latitude' is not mapped")
    expect(push).not.toHaveBeenCalled()
  })
})
