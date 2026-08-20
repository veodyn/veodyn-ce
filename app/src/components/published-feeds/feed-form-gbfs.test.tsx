import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
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

const VEHICLES_FEED: PublishedFeed = {
  ...GBFS_FEED,
  slug: 'scooters-live',
  entity: 'vehicles',
  columnMap: {
    vehicle_id: 'vid',
    lat: 'y',
    lon: 'x',
    is_reserved: 'res',
    is_disabled: 'dis',
    last_reported: 'seen',
  },
}

// Query 3 points at result 103, whose columns are real enough to map against:
// station_name / lat / lon / bikes / docks / total_capacity / pct_full. The six
// required fields are prefilled from them and current_range_meters is left for
// the test to map, which is the only way its row gets rendered at all.
const MAPPABLE_VEHICLES_FEED: PublishedFeed = {
  ...VEHICLES_FEED,
  queryId: 3,
  columnMap: {
    vehicle_id: 'station_name',
    lat: 'lat',
    lon: 'lon',
    is_reserved: 'bikes',
    is_disabled: 'docks',
    last_reported: 'pct_full',
  },
}

async function mapField(user: ReturnType<typeof userEvent.setup>, field: string, column: string) {
  const row = screen.getByText(field).closest('tr') as HTMLElement
  await user.click(within(row).getByRole('combobox'))
  await user.click(await screen.findByRole('option', { name: column }))
}

function renderEdit(onSubmit = vi.fn(), initial: PublishedFeed = GBFS_FEED) {
  renderWithProviders(
    <FeedForm
      initial={initial}
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

  it('submits a vehicles binding under its own column map', async () => {
    // Both feeds are gbfs at 2.3, so the standard cannot be what picks the
    // vocabulary: read as stations, none of these fields would survive the
    // round trip and the form would refuse on the mapping instead.
    const user = userEvent.setup()
    const onSubmit = renderEdit(vi.fn(), VEHICLES_FEED)

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'vehicles', columnMap: VEHICLES_FEED.columnMap })
    )
  })

  it('offers current_range_meters as an optional field and submits what it is mapped to', async () => {
    // The one optional field of the dockless shape. Dropped from the
    // vocabulary, this row would not render and nothing else here would notice.
    const user = userEvent.setup()
    const onSubmit = renderEdit(vi.fn(), MAPPABLE_VEHICLES_FEED)

    // Awaited: the mapping table is a row of prose until the bound query's
    // columns land, so there is nothing to map against on the first render.
    expect(await screen.findByText('current_range_meters')).toBeInTheDocument()
    await mapField(user, 'current_range_meters', 'total_capacity')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        columnMap: { ...MAPPABLE_VEHICLES_FEED.columnMap, current_range_meters: 'total_capacity' },
      })
    )
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

  it('offers the timezone names this deployment reported rather than asking for one', async () => {
    // GBFS spells timezone as an enum, so the names come from the capabilities
    // read, which serves the enum out of the schema a publish is judged against.
    const user = userEvent.setup()
    renderEdit()

    // Awaited, not read straight off: the field is a plain text input until the
    // capabilities read lands and gives it a vocabulary to offer.
    const timezone = await screen.findByRole('combobox', { name: 'timezone' })
    await user.clear(timezone)
    await user.type(timezone, 'berl')
    await user.click(await screen.findByText('Europe/Berlin'))

    expect(timezone).toHaveValue('Europe/Berlin')
  })

  it('names a language subtag, and refuses one that is not the shape GBFS defines', async () => {
    const user = userEvent.setup()
    const onSubmit = renderEdit()
    const language = screen.getByLabelText('language')

    await user.clear(language)
    await user.type(language, 'English')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getAllByText(/en or en-GB/i).length).toBeGreaterThan(0)

    await user.clear(language)
    await user.type(language, 'en-GB')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ systemInfo: expect.objectContaining({ language: 'en-GB' }) })
    )
  })
})
