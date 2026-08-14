import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, screen } from '@testing-library/react'
import { renderWithProviders, resetStores } from '@/test/utils'
import * as useCatalogModule from '@/hooks/use-catalog'
import { mockDatasets } from '@/lib/mock-data'
import { required } from '@/lib/required'
import DatasetDetailPage from './page'

// Partial mock: wrap the real useDataset in a vi.fn so a single test can
// force an error state, while every other test still exercises the real
// hook reading from the mock data store.
vi.mock('@/hooks/use-catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-catalog')>()
  return { ...actual, useDataset: vi.fn(actual.useDataset) }
})
const useDatasetSpy = vi.mocked(useCatalogModule.useDataset)

afterEach(() => {
  // UNMOUNT BEFORE TOUCHING THE SPY. Same hazard as the one described below,
  // reached from the other side: RTL's auto-cleanup is registered when the
  // setup file imports it, this hook is registered later, and vitest runs
  // afterEach hooks in reverse registration order. So without this line the
  // stub is swapped back to the real hook while the last test's tree is STILL
  // MOUNTED, and the next pending query to settle re-renders that tree through
  // a useDataset that now calls useQuery where the mounted render called no
  // hooks at all. React walks to a hook slot that holds another hook's
  // memoizedState, reads deps off it, and throws
  // "Cannot read properties of undefined (reading 'length')" from
  // areHookInputsEqual, as an unhandled error AFTER the test has passed.
  // Verified: `--sequence.hooks=list` alone makes it disappear.
  cleanup()

  // Back to the wrapped real hook. A stub that only answered the FIRST call
  // made the page render with one hook shape and then re-render with another
  // as soon as anything else on the page settled, which React reports as a
  // changed hook order rather than as the stub it is.
  useDatasetSpy.mockReset()
  resetStores()
})

async function renderPage(datasetId: string) {
  // DatasetDetailPage reads `params` via React's `use()`, which suspends on
  // mount even for an already-resolved promise (a native Promise always
  // defers its .then callback to a microtask). Wrapping the render in an
  // awaited act() lets that microtask -- and the Suspense retry it triggers
  // -- flush before we assert (see dashboards/[dashboardId]/dashboard-title.test.tsx).
  await act(async () => {
    renderWithProviders(<DatasetDetailPage params={Promise.resolve({ datasetId })} />)
  })
}

// Read off the active pack, so this file passes under either demo pack: the
// pack's one rail dataset (a fast-cadence feed that has gone quiet by any
// real "now", so its freshness derives to Down regardless of which pack's
// dates it carries), a dataset with no sample query, and the dataset with a
// null domain.
const railDataset = required(mockDatasets.find((d) => d.domain === 'rail'), 'the rail dataset')
const noQueryDataset = required(
  mockDatasets.find((d) => d.sampleQueryId === null),
  'a dataset with no sample query'
)
const unfiledDataset = required(mockDatasets.find((d) => d.domain === null), 'a dataset with a null domain')

// MM/DD/YY, the pattern the page's date formatter renders. Sliced from the
// ISO fixture rather than hardcoded, so this holds for whichever pack is
// active.
function mmddyy(iso: string): string {
  return `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(2, 4)}`
}
const coverageStart = mmddyy(railDataset.coverage.start)
const coverageEnd = mmddyy(railDataset.coverage.end)

describe('DatasetDetailPage', () => {
  it('renders the dataset name, schema, freshness, coverage and row count, and a working query CTA', async () => {
    await renderPage(railDataset.id)

    const heading = await screen.findByText(railDataset.name)
    expect(heading).toHaveClass('font-display')

    // Schema table shows a column name. Not schema[0] ("date"): the freshness
    // badge repeats that word in its own "N days ago" caption, so this picks a
    // column name unique to the schema table.
    const distinctiveColumn = required(
      railDataset.schema.find((c) => c.name !== 'date'),
      'a rail dataset column other than date'
    )
    expect(screen.getByText(distinctiveColumn.name)).toBeInTheDocument()

    // Freshness badge. The verdict is derived from the feed's cadence once the
    // feeds load, so this has to wait for that rather than catching the
    // declared status mid-flight: this dataset's fixture says Fresh but is days
    // old against a five-minute feed, which is the disagreement the derivation
    // exists to settle.
    expect(await screen.findByText('Down')).toBeInTheDocument()

    // Coverage renders through Settings > Formats like every other date in the
    // product, rather than slicing the ISO string, which made this the one
    // page that ignored the operator's chosen pattern.
    const coverage = screen.getByText(new RegExp(coverageStart.replace(/\//g, '\\/')))
    expect(coverage).toHaveClass('font-mono', 'tabular-nums')
    expect(coverage).toHaveTextContent(coverageEnd)

    const rowCount = screen.getByText(railDataset.rowCount.toLocaleString())
    expect(rowCount).toHaveClass('font-mono', 'tabular-nums')

    // "Query this dataset" CTA points at the dataset's real sample query.
    // The base-ui Button primitive stamps role="button" on the rendered <a>
    // when it's swapped for a Link via `render`, so this queries by button
    // role (not link) even though the underlying element is an anchor.
    const cta = screen.getByRole('button', { name: /query this dataset/i })
    expect(cta).toHaveAttribute('href', `/queries/${railDataset.sampleQueryId}`)
  })

  it('sends the CTA to /queries/new when the dataset has no sample query', async () => {
    await renderPage(noQueryDataset.id)
    await screen.findByText(noQueryDataset.name)

    const cta = screen.getByRole('button', { name: /query this dataset/i })
    expect(cta).toHaveAttribute('href', '/queries/new')
  })

  it('renders a not-found state for an unknown dataset id', async () => {
    await renderPage('does-not-exist')

    expect(await screen.findByText(/dataset not found/i)).toBeInTheDocument()
  })

  it('links a non-null domain to its hub', async () => {
    await renderPage(railDataset.id)
    await screen.findByText(railDataset.name)

    const domainLink = screen.getByRole('link', { name: new RegExp(`domain: ${railDataset.domain}`, 'i') })
    expect(domainLink).toHaveAttribute('href', `/data/${railDataset.domain}`)
  })

  it('renders no domain link for a dataset with a null domain', async () => {
    await renderPage(unfiledDataset.id)
    await screen.findByText(unfiledDataset.name)

    expect(screen.queryByText(/^Domain:/)).not.toBeInTheDocument()
  })

  it('shows a distinct outage message when the dataset query errors, not the not-found message', async () => {
    useDatasetSpy.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    } as ReturnType<typeof useCatalogModule.useDataset>)

    await renderPage(railDataset.id)

    expect(
      await screen.findByText(/unable to load this dataset\. the catalog service may be unavailable\./i)
    ).toBeInTheDocument()
    expect(screen.queryByText(/dataset not found/i)).not.toBeInTheDocument()
  })
})
