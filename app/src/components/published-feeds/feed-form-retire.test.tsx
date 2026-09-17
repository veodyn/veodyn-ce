import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores } from '@/test/utils'
import { FeedForm } from './feed-form'
import type { PublishedFeed } from '@/types/published-feed'

afterEach(() => resetStores())

const RETIRING: PublishedFeed = {
  slug: 'vehicles-live',
  revision: 2,
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
  retireOnFailure: true,
  visibility: 'private',
  bindingState: 'unknown',
}

function renderForm(initial?: PublishedFeed) {
  const onSubmit = vi.fn()
  renderWithProviders(
    <FeedForm
      initial={initial}
      slugLocked={initial != null}
      submitLabel={initial ? 'Save' : 'Publish'}
      isPending={false}
      error={null}
      fieldErrors={{}}
      onSubmit={onSubmit}
      onCancel={vi.fn()}
    />
  )
  return onSubmit
}

function theSwitch() {
  return screen.getByRole('switch', { name: /retire the served artifact/i })
}

describe('retire on failure', () => {
  it('is off on a fresh binding, and says what off means', () => {
    renderForm()

    expect(theSwitch()).not.toBeChecked()
    expect(screen.getByText(/the artifact already serving stays up/i)).toBeInTheDocument()
  })

  it('states the consequence of the direction it is actually in', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.click(theSwitch())

    // The whole point of the copy: on and off are not equally safe, and which
    // one is safe depends on the feed, so a switch that only named itself
    // would leave the reader to guess which way is which.
    expect(screen.getByText(/takes this feed dark/i)).toBeInTheDocument()
    expect(screen.queryByText(/already serving stays up/i)).not.toBeInTheDocument()
  })

  it('submits false unless it is turned on', async () => {
    const user = userEvent.setup()
    const onSubmit = renderForm()

    const searchBox = screen.getByPlaceholderText(/search queries/i)
    await user.type(searchBox, 'Bike Share')
    await user.click(await screen.findByRole('button', { name: /Bike Share Station Availability/i }))
    await screen.findByRole('button', { name: 'Change' })
    await user.type(screen.getByLabelText('Slug'), 'test-feed')
    await user.type(screen.getByLabelText('Static GTFS reference'), 'https://example.com/static.zip')
    for (const [field, column] of [
      ['vehicle_id', 'station_name'],
      ['latitude', 'lat'],
      ['longitude', 'lon'],
    ]) {
      const row = screen.getByText(field).closest('tr') as HTMLElement
      await user.click(within(row).getByRole('combobox'))
      await user.click(await screen.findByRole('option', { name: column }))
    }

    await user.click(screen.getByRole('button', { name: 'Publish' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ retireOnFailure: false }))
  })

  it('names the failure by what actually retires the feed, not by validation alone', () => {
    renderForm()

    // A publish also fails on a missing producer, a producer refusal and a
    // validator answering with zero enabled rules, none of which is a
    // conformance verdict, so "failed validation" describes a subset.
    expect(screen.getByText(/failed publish attempt/i)).toBeInTheDocument()
    expect(screen.queryByText(/failed validation/i)).not.toBeInTheDocument()
  })

  it('is not offered under last known good, and says why', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.click(screen.getByRole('radio', { name: /last known good/i }))

    expect(screen.queryByRole('switch', { name: /retire the served artifact/i })).not.toBeInTheDocument()
    expect(screen.getByText(/would clear the artifact the maximum age above promises to keep serving/i))
      .toBeInTheDocument()
  })

  it('sends false under last known good even when it was on beforehand', async () => {
    const user = userEvent.setup()
    const onSubmit = renderForm(RETIRING)
    await screen.findByText('Bike Share Station Availability')

    expect(theSwitch()).toBeChecked()

    await user.click(screen.getByRole('radio', { name: /last known good/i }))
    await user.type(screen.getByLabelText(/maximum age/i), '300')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    // The API refuses the pair outright, so the form must not send a
    // combination it has just told the reader is unavailable.
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ onError: 'last_good', lastGoodMaxAgeSeconds: 300, retireOnFailure: false })
    )
  })

  it('prefills from the binding, so an edit cannot silently turn it off', async () => {
    const user = userEvent.setup()
    const onSubmit = renderForm(RETIRING)
    await screen.findByText('Bike Share Station Availability')

    expect(theSwitch()).toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ retireOnFailure: true }))
  })
})
