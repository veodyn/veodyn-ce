import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores } from '@/test/utils'
import { FeedForm } from './feed-form'
import type { PublishedFeed } from '@/types/published-feed'

afterEach(() => resetStores())

const GBFS_FEED: PublishedFeed = {
  slug: 'bikes-live',
  revision: 1,
  queryId: 2,
  standard: 'gbfs',
  version: '2.3',
  entity: 'stations',
  staticGtfsRef: null,
  systemInfo: {
    system_id: 'city',
    language: 'en',
    name: 'City Bikes',
    timezone: 'America/Los_Angeles',
  },
  sourceColumn: null,
  // Every required stations field, or the form refuses on the mapping before it
  // ever reaches the system rules these tests are about.
  columnMap: {
    station_id: 'sid',
    name: 'nm',
    lat: 'lat',
    lon: 'lon',
    num_vehicles_available: 'bikes',
    is_installed: 'inst',
    is_renting: 'rent',
    is_returning: 'ret',
    last_reported: 'seen',
  },
  onError: 'block',
  lastGoodMaxAgeSeconds: null,
  visibility: 'private',
  bindingState: 'unknown',
}

function renderEdit(onSubmit = vi.fn()) {
  renderWithProviders(
    <FeedForm
      initial={GBFS_FEED}
      slugLocked
      submitLabel="Save"
      isPending={false}
      error={null}
      fieldErrors={{}}
      onSubmit={onSubmit}
      onCancel={vi.fn()}
    />
  )
  return onSubmit
}

describe('editing a gbfs binding', () => {
  it('shows the system declaration and the gbfs field vocabulary', () => {
    renderEdit()

    expect(screen.getByText('System')).toBeInTheDocument()
    expect(screen.getByText('system_id')).toBeInTheDocument()
    expect(screen.getByDisplayValue('City Bikes')).toBeInTheDocument()
    // The gtfs-rt half must be absent, not blank.
    expect(screen.queryByLabelText(/static gtfs reference/i)).not.toBeInTheDocument()
    expect(screen.queryByText('vehicle_id')).not.toBeInTheDocument()
  })

  it('never offers to convert the binding, which would destroy its system info', () => {
    // The edit route hands every binding to this one form. Before the form knew
    // about standards it submitted gtfs-rt with systemInfo null, and the API
    // takes a whole-binding PUT: the system declaration would simply be gone.
    renderEdit()

    expect(screen.queryByRole('combobox', { name: /standard/i })).not.toBeInTheDocument()
    expect(screen.getByText('gbfs')).toBeInTheDocument()
  })

  it('submits the binding unchanged, keeping systemInfo and a null static ref', async () => {
    const user = userEvent.setup()
    const onSubmit = renderEdit()

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        standard: 'gbfs',
        version: '2.3',
        entity: 'stations',
        staticGtfsRef: null,
        systemInfo: expect.objectContaining({ system_id: 'city', name: 'City Bikes' }),
      })
    )
  })

  it('refuses to save when a required system field has been emptied', async () => {
    const user = userEvent.setup()
    const onSubmit = renderEdit()

    await user.clear(screen.getByDisplayValue('city'))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText(/system field/i)).toBeInTheDocument()
  })

  it('asks for the two extra fields 3.0 requires and 2.3 does not', async () => {
    const user = userEvent.setup()
    renderEdit()

    expect(screen.queryByText('feed_contact_email')).not.toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: /version/i }))
    await user.click(await screen.findByRole('option', { name: '3.0' }))

    expect(screen.getByText('feed_contact_email')).toBeInTheDocument()
    expect(screen.getByText('opening_hours')).toBeInTheDocument()
  })
})
