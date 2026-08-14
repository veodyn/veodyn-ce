import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores, signInAsAdmin } from '@/test/utils'
import { AppError, ErrorIds } from '@/lib/errorIds'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back: vi.fn() }),
}))

const mutateAsync = vi.fn()
vi.mock('@/hooks/use-published-feeds', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/use-published-feeds')>(
    '@/hooks/use-published-feeds'
  )
  return {
    ...actual,
    // Mock mode's store never refuses a create, so the refusal-mapping tests
    // below control the mutation directly. useQueryResultColumns stays real,
    // reading the fixture query and its result from the mock store, so the
    // mapping table exercises the same columns a real pick would produce.
    useCreatePublishedFeed: () => ({ mutateAsync, isPending: false }),
  }
})

import NewFeedPage from './page'

afterEach(() => {
  resetStores()
  mutateAsync.mockReset()
  push.mockClear()
})

async function mapField(user: ReturnType<typeof userEvent.setup>, fieldName: string, columnName: string) {
  const row = screen.getByText(fieldName).closest('tr') as HTMLElement
  await user.click(within(row).getByRole('combobox'))
  await user.click(await screen.findByRole('option', { name: columnName }))
}

// Query 3 (Bike Share Station Availability) points at result 103, whose
// columns include station_name/lat/lon: enough to map every required field.
async function fillValidForm(user: ReturnType<typeof userEvent.setup>, opts: { skipLatitude?: boolean } = {}) {
  // The form is admin-only now, so every test that means to fill it in has to
  // be signed in as one first.
  signInAsAdmin()
  renderWithProviders(<NewFeedPage />)
  await user.type(screen.getByPlaceholderText(/search queries/i), 'Bike Share')
  await user.click(await screen.findByRole('button', { name: /Bike Share Station Availability/i }))
  // Flush the picked-query state (and the useQueryById/useQueryResultColumns
  // reads it triggers) before interacting with the mapping table it renders.
  await screen.findByRole('button', { name: 'Change' })

  await mapField(user, 'vehicle_id', 'station_name')
  if (!opts.skipLatitude) await mapField(user, 'latitude', 'lat')
  await mapField(user, 'longitude', 'lon')

  await user.type(screen.getByLabelText('Slug'), 'test-feed')
  await user.type(screen.getByLabelText('Static GTFS reference'), 'https://example.com/static.zip')
}

describe('publishing a new feed', () => {
  it('shows a non-admin the arrangement instead of a form that can only fail', async () => {
    // The server refuses the create with a 403 either way, so this is about the
    // reader filling in a whole binding before finding that out.
    renderWithProviders(<NewFeedPage />)

    expect(await screen.findByText(/publishing is administered/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('Slug')).not.toBeInTheDocument()
  })

  it('blocks the post and names the field when a required field is left unmapped', async () => {
    const user = userEvent.setup()
    await fillValidForm(user, { skipLatitude: true })

    await user.click(screen.getByRole('button', { name: 'Publish' }))

    expect(
      await screen.findByText(/map every required field before publishing: latitude/i)
    ).toBeInTheDocument()
    expect(mutateAsync).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('puts a slug collision refusal on the slug field', async () => {
    const user = userEvent.setup()
    await fillValidForm(user)
    mutateAsync.mockRejectedValueOnce(
      new AppError(ErrorIds.PUBLISHED_FEED_REQUEST_FAILED, "a feed is already published at 'test-feed'", {
        status: 409,
        errorId: 'VEODYN_PUBLISHED_FEED_SLUG_TAKEN',
      })
    )

    await user.click(screen.getByRole('button', { name: 'Publish' }))

    const slugRow = screen.getByLabelText('Slug').closest('div') as HTMLElement
    expect(await within(slugRow).findByRole('alert')).toHaveTextContent(/already published/i)
    expect(push).not.toHaveBeenCalled()
  })

  it('puts each binding-invalid problem on its own mapping row', async () => {
    const user = userEvent.setup()
    await fillValidForm(user)
    mutateAsync.mockRejectedValueOnce(
      new AppError(
        ErrorIds.PUBLISHED_FEED_REQUEST_FAILED,
        "the column map cannot produce this feed: required field 'latitude' is not mapped; required field 'longitude' is not mapped",
        { status: 422, errorId: 'VEODYN_PUBLISHED_FEED_BINDING_INVALID' }
      )
    )

    await user.click(screen.getByRole('button', { name: 'Publish' }))

    const latitudeRow = (await screen.findByText('latitude')).closest('tr') as HTMLElement
    expect(within(latitudeRow).getByRole('alert')).toHaveTextContent("'latitude' is not mapped")
    const longitudeRow = screen.getByText('longitude').closest('tr') as HTMLElement
    expect(within(longitudeRow).getByRole('alert')).toHaveTextContent("'longitude' is not mapped")
    expect(push).not.toHaveBeenCalled()
  })

  it('routes to the detail page on a successful create', async () => {
    const user = userEvent.setup()
    await fillValidForm(user)
    mutateAsync.mockResolvedValueOnce({
      slug: 'test-feed',
      queryId: 3,
      standard: 'gtfs-rt',
      version: '2.0',
      entity: 'vehicle_positions',
      staticGtfsRef: 'https://example.com/static.zip',
      sourceColumn: null,
      columnMap: { vehicle_id: 'station_name', latitude: 'lat', longitude: 'lon' },
      onError: 'block',
      lastGoodMaxAgeSeconds: null,
      visibility: 'private',
      revision: 1,
      bindingState: 'ok',
    })

    await user.click(screen.getByRole('button', { name: 'Publish' }))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/connect/feeds/test-feed'))
  })
})
