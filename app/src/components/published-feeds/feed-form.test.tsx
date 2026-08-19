import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores } from '@/test/utils'
import { FeedForm } from './feed-form'
import type { PublishedFeed } from '@/types/published-feed'

afterEach(() => resetStores())

async function mapField(user: ReturnType<typeof userEvent.setup>, fieldName: string, columnName: string) {
  const row = screen.getByText(fieldName).closest('tr') as HTMLElement
  await user.click(within(row).getByRole('combobox'))
  await user.click(await screen.findByRole('option', { name: columnName }))
}

function mappedColumnFor(fieldName: string): string {
  const row = screen.getByText(fieldName).closest('tr') as HTMLElement
  return within(row).getByRole('combobox').textContent ?? ''
}

async function pickQuery(user: ReturnType<typeof userEvent.setup>, search: string, buttonName: RegExp) {
  // QueryPicker does not remount between its search view and its summary
  // view, so its internal search text survives a "Change" round trip; clear
  // it first or a second pick's search string appends to the first.
  const searchBox = screen.getByPlaceholderText(/search queries/i)
  await user.clear(searchBox)
  await user.type(searchBox, search)
  await user.click(await screen.findByRole('button', { name: buttonName }))
  await screen.findByRole('button', { name: 'Change' })
}

function renderCreateForm(onSubmit = vi.fn()) {
  renderWithProviders(
    <FeedForm
      submitLabel="Publish"
      isPending={false}
      error={null}
      fieldErrors={{}}
      onSubmit={onSubmit}
      onCancel={vi.fn()}
    />
  )
  return onSubmit
}

// Query 3 (Bike Share Station Availability) points at result 103
// (station_name/lat/lon/...); query 1 (Rail Network Daily Ridership) points
// at result 101 (date/line/vehicle_count/avg_speed). Neither set of columns
// overlaps the other, so a survived mapping is unmistakable in either
// direction.
describe('switching the source query', () => {
  it('clears a mapping built against the previous query', async () => {
    const user = userEvent.setup()
    renderCreateForm()

    await pickQuery(user, 'Bike Share', /Bike Share Station Availability/i)
    await mapField(user, 'vehicle_id', 'station_name')
    expect(mappedColumnFor('vehicle_id')).toContain('station_name')

    await user.click(screen.getByRole('button', { name: 'Change' }))
    await pickQuery(user, 'Rail Network', /Rail Network Daily Ridership/i)

    // station_name is not one of query 1's columns, so a survived mapping
    // would print the raw stale value here rather than falling back to "Not
    // mapped" (see the doc comment on Select in @/components/ui/select.tsx).
    expect(mappedColumnFor('vehicle_id')).toContain('Not mapped')
  })

  it('keeps the mapping when the same query is re-picked after Change', async () => {
    const user = userEvent.setup()
    renderCreateForm()

    await pickQuery(user, 'Bike Share', /Bike Share Station Availability/i)
    await mapField(user, 'vehicle_id', 'station_name')

    await user.click(screen.getByRole('button', { name: 'Change' }))
    await pickQuery(user, 'Bike Share', /Bike Share Station Availability/i)

    expect(mappedColumnFor('vehicle_id')).toContain('station_name')
  })

  it('has nothing to clear on the very first pick', async () => {
    const user = userEvent.setup()
    renderCreateForm()

    await pickQuery(user, 'Bike Share', /Bike Share Station Availability/i)

    expect(mappedColumnFor('vehicle_id')).toContain('Not mapped')
  })
})

describe('the order the form asks in', () => {
  it('asks for the shape before the source, because the shape decides the rest', () => {
    renderCreateForm()

    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(headings.slice(0, 3)).toEqual(['Shape', 'Source', 'Address'])
  })
})

describe('editing an existing binding', () => {
  const initial: PublishedFeed = {
    slug: 'vehicles-live',
    queryId: 3,
    standard: 'gtfs-rt',
    version: '2.0',
    entity: 'vehicle_positions',
    staticGtfsRef: 'https://example.com/static.zip',
    systemInfo: null,
    sourceColumn: null,
    columnMap: { vehicle_id: 'station_name', latitude: 'lat', longitude: 'lon' },
    onError: 'block',
    lastGoodMaxAgeSeconds: null,
    visibility: 'private',
    revision: 2,
    bindingState: 'unknown',
  }

  function renderEditForm() {
    renderWithProviders(
      <FeedForm
        initial={initial}
        slugLocked
        submitLabel="Save"
        isPending={false}
        error={null}
        fieldErrors={{}}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    )
  }

  it('keeps the prefilled mapping on mount, without wiping it just because the form loaded', async () => {
    renderEditForm()

    await screen.findByText('Bike Share Station Availability')
    expect(mappedColumnFor('vehicle_id')).toContain('station_name')
  })

  it('clears the prefilled mapping when the editor switches the bound query', async () => {
    const user = userEvent.setup()
    renderEditForm()
    await screen.findByText('Bike Share Station Availability')

    await user.click(screen.getByRole('button', { name: 'Change' }))
    await pickQuery(user, 'Rail Network', /Rail Network Daily Ridership/i)

    expect(mappedColumnFor('vehicle_id')).toContain('Not mapped')
  })
})

describe('the last-known-good age cap', () => {
  it('refuses to submit an empty cap rather than sending 0', async () => {
    const user = userEvent.setup()
    const onSubmit = renderCreateForm()

    await pickQuery(user, 'Bike Share', /Bike Share Station Availability/i)
    await mapField(user, 'vehicle_id', 'station_name')
    await mapField(user, 'latitude', 'lat')
    await mapField(user, 'longitude', 'lon')
    await user.type(screen.getByLabelText('Slug'), 'test-feed')
    await user.type(screen.getByLabelText('Static GTFS reference'), 'https://example.com/static.zip')
    await user.click(screen.getByRole('radio', { name: /last known good/i }))

    await user.click(screen.getByRole('button', { name: 'Publish' }))

    // Shown twice: once on the cap field itself, once as the form-level
    // summary the top-level submit path uses for every other local refusal.
    expect((await screen.findAllByText(/maximum age.*is required/i)).length).toBeGreaterThan(0)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('refuses a zero or negative cap the same way', async () => {
    const user = userEvent.setup()
    const onSubmit = renderCreateForm()

    await pickQuery(user, 'Bike Share', /Bike Share Station Availability/i)
    await mapField(user, 'vehicle_id', 'station_name')
    await mapField(user, 'latitude', 'lat')
    await mapField(user, 'longitude', 'lon')
    await user.type(screen.getByLabelText('Slug'), 'test-feed')
    await user.type(screen.getByLabelText('Static GTFS reference'), 'https://example.com/static.zip')
    await user.click(screen.getByRole('radio', { name: /last known good/i }))
    await user.type(screen.getByLabelText(/maximum age/i), '0')

    await user.click(screen.getByRole('button', { name: 'Publish' }))

    expect((await screen.findAllByText(/greater than zero/i)).length).toBeGreaterThan(0)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits a positive whole-number cap', async () => {
    const user = userEvent.setup()
    const onSubmit = renderCreateForm()

    await pickQuery(user, 'Bike Share', /Bike Share Station Availability/i)
    await mapField(user, 'vehicle_id', 'station_name')
    await mapField(user, 'latitude', 'lat')
    await mapField(user, 'longitude', 'lon')
    await user.type(screen.getByLabelText('Slug'), 'test-feed')
    await user.type(screen.getByLabelText('Static GTFS reference'), 'https://example.com/static.zip')
    await user.click(screen.getByRole('radio', { name: /last known good/i }))
    await user.type(screen.getByLabelText(/maximum age/i), '300')

    await user.click(screen.getByRole('button', { name: 'Publish' }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ onError: 'last_good', lastGoodMaxAgeSeconds: 300 })
    )
  })
})
