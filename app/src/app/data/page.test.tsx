import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores } from '@/test/utils'
import { ConfigProvider } from '@/components/config/config-provider'
import { toClientConfig, NEUTRAL_CONFIG } from '@/lib/config-schema'
import * as useCatalogModule from '@/hooks/use-catalog'
import { mockDatasets } from '@/lib/mock-data'
import { required } from '@/lib/required'
import DataCatalogPage from './page'

// Partial mock: wrap the real useCatalog in a vi.fn so a single test can
// force an error state, while every other test still exercises the real
// hook reading from the mock data store.
vi.mock('@/hooks/use-catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-catalog')>()
  return { ...actual, useCatalog: vi.fn(actual.useCatalog) }
})
const useCatalogSpy = vi.mocked(useCatalogModule.useCatalog)

afterEach(() => resetStores())

const configValue = toClientConfig({
  ...NEUTRAL_CONFIG,
  domains: [
    { key: 'transit', label: 'Transit' },
    { key: 'freeway', label: 'Freeways' },
    { key: 'rail', label: 'Rail' },
  ],
})

function renderPage() {
  return renderWithProviders(
    <ConfigProvider value={configValue}>
      <DataCatalogPage />
    </ConfigProvider>
  )
}

// Picked from the active pack rather than hardcoded to one demo pack's
// dataset names, so this file passes under either. A transit dataset (no
// sample query, so its name has to stand on its own), the pack's one rail
// dataset, and the dataset tagged "availability", which also carries the
// "bike-share" tag, for the case-insensitive tag match below.
const transitDataset = required(
  mockDatasets.find((d) => d.domain === 'transit' && d.sampleQueryId === null),
  'a transit dataset with no sample query'
)
const railDataset = required(
  mockDatasets.find((d) => d.domain === 'rail'),
  'the rail dataset'
)
const availabilityDataset = required(
  mockDatasets.find((d) => d.tags.includes('availability') && d.tags.includes('bike-share')),
  'the dataset tagged availability and bike-share'
)
// A word from the transit dataset's own name, short of anything the other two
// datasets asserted here happen to share.
const SEARCH_TERM = transitDataset.name.split(' ')[0].toLowerCase()

describe('DataCatalogPage', () => {
  it('renders the Data Catalog heading', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Data Catalog' })).toBeInTheDocument()
  })

  it('renders a seeded dataset name', async () => {
    renderPage()
    expect(await screen.findByText(transitDataset.name)).toBeInTheDocument()
  })

  it('filters the list as the user types in search', async () => {
    renderPage()
    await screen.findByText(transitDataset.name)
    expect(screen.getByText(railDataset.name)).toBeInTheDocument()

    const user = userEvent.setup()
    // By role and accessible name, not by placeholder text. This asserted the
    // exact string "Search datasets" and broke when the placeholder gained the
    // trailing ellipsis the other eight lists already had, which is a copy edit
    // and not a behaviour change.
    await user.type(screen.getByRole('searchbox', { name: /search datasets/i }), SEARCH_TERM)

    expect(screen.getByText(transitDataset.name)).toBeInTheDocument()
    expect(screen.queryByText(railDataset.name)).not.toBeInTheDocument()
  })

  // A tag could be saved on a dataset and then found from nowhere a person
  // would look: the catalog showed no tag on any card, had no tag filter, and
  // its search matched names and descriptions only. Typing a tag that was on
  // sixteen objects returned "0 datasets".
  it('finds a dataset by a tag, not just by its name', async () => {
    renderPage()
    await screen.findByText(transitDataset.name)

    const user = userEvent.setup()
    // On the bike-share datasets and on nothing whose NAME contains it, so a
    // page still matching names only cannot pass this by accident.
    await user.type(screen.getByRole('searchbox', { name: /search datasets/i }), 'availability')

    expect(screen.getByText(availabilityDataset.name)).toBeInTheDocument()
    expect(screen.queryByText(transitDataset.name)).not.toBeInTheDocument()
  })

  it('matches a tag whatever case it is typed in', async () => {
    // Unlike the exact `?tag=` facet, which Redash matches case-sensitively
    // because a tag is an identifier there. This is a search box.
    renderPage()
    await screen.findByText(transitDataset.name)

    const user = userEvent.setup()
    await user.type(screen.getByRole('searchbox', { name: /search datasets/i }), 'Bike-Share')

    expect(screen.getByText(availabilityDataset.name)).toBeInTheDocument()
  })

  it('filters to a single domain when one is selected', async () => {
    renderPage()
    await screen.findByText(transitDataset.name)

    const user = userEvent.setup()
    await user.click(screen.getByLabelText('Filter by domain'))
    await user.click(screen.getByText('Rail'))

    expect(screen.getByText(railDataset.name)).toBeInTheDocument()
    expect(screen.queryByText(transitDataset.name)).not.toBeInTheDocument()
  })

  it('exposes the search box by an accessible name for screen readers', async () => {
    renderPage()
    await screen.findByText(transitDataset.name)

    // searchbox, not textbox: the shared ListToolbar renders type="search", so
    // this field now has the same role as every other list's. The accessible
    // name still comes from a visually hidden <label htmlFor>, which is the
    // part actually worth asserting.
    expect(screen.getByRole('searchbox', { name: /search datasets/i })).toBeInTheDocument()
  })

  it('shows a distinct outage message when the catalog query errors, not the empty-filter message', async () => {
    useCatalogSpy.mockReturnValueOnce({
      data: undefined,
      isLoading: false,
      isError: true,
    } as ReturnType<typeof useCatalogModule.useCatalog>)

    renderPage()

    expect(
      await screen.findByText(/unable to load the catalog\. the catalog service may be unavailable\./i)
    ).toBeInTheDocument()
    expect(screen.queryByText('No datasets match.')).not.toBeInTheDocument()
  })
})
