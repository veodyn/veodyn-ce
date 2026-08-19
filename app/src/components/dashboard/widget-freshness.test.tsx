import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders, resetStores } from '@/test/utils'
import type { Dataset } from '@/types/catalog'
import type { Capture } from '@/types/capture'
import { WidgetFreshness } from './widget-freshness'

// The defect: the widget header drew a green check whenever a result existed.
// Not a freshness verdict at all, so two widgets on one dashboard, one refreshed
// an hour ago and one six days old, rendered identically. It borrowed the
// product's freshness vocabulary (`text-status-fresh` plus a check, which is
// exactly CAPTURE_STATUS_META.fresh), so a reader who had learned that signal
// from the catalog, Feed Health or a KPI badge read it here and was wrong.

const QUERY_ID = 44
const TABLE = 'q_regional_demo_bikeshare_stations_32'
const NOW = Date.parse('2026-08-03T12:00:00Z')

function dataset(over: Partial<Dataset['freshness']> = {}): Dataset {
  return {
    id: TABLE,
    name: 'Bikeshare stations',
    description: '',
    domain: null,
    schema: [],
    freshness: {
      lastUpdatedAt: new Date(NOW - 60_000).toISOString(),
      status: 'fresh',
      captureId: 'bikeshare',
      ...over,
    },
    coverage: { start: '', end: '' },
    rowCount: 1,
    sources: [],
    tags: [],
    sampleQueryId: null,
    origin: 'capture',
    writable: false,
  }
}

const capture: Capture = {
  id: 'bikeshare',
  name: 'Bikeshare',
  source: 'gbfs',
  cadence: 'every 5 min',
  status: 'fresh',
  lastReceivedAt: new Date(NOW - 60_000).toISOString(),
} as Capture

vi.mock('@/hooks/use-captures', () => ({ useCaptures: () => ({ data: [capture] }) }))

let datasets: Dataset[] = []
vi.mock('@/hooks/use-catalog', () => ({ useCatalog: () => ({ data: datasets }) }))

// The edge is the table the widget's query reads, the same one kpi-freshness
// resolves. A fixture that shares a query id instead would pass while resolving
// nothing on a real instance, which is the trap datasetForKpi already records.
vi.mock('@/hooks/use-query-sql', () => ({
  useQuerySqlById: () => new Map([[QUERY_ID, `SELECT * FROM historical.${TABLE}`]]),
}))

afterEach(() => resetStores())

function render(now: number | null = NOW) {
  return renderWithProviders(
    <WidgetFreshness
      queryId={QUERY_ID}
      retrievedAt={new Date(NOW - 3_600_000).toISOString()}
      now={now}
    />
  )
}

describe('a dashboard widget freshness indicator', () => {
  it('warns when the data underneath is stale, however recently the query ran', () => {
    // 30 minutes behind an every-5-min capture: six cadence periods, which
    // deriveCaptureStatus calls Stale (fresh within two, stale to ten, down
    // beyond). The query result is an hour old either way, which is the case
    // the old always-green check got wrong.
    datasets = [dataset({ lastUpdatedAt: new Date(NOW - 30 * 60_000).toISOString() })]
    render()

    const status = screen.getByText(/ago/i)
    expect(status.className).toContain('text-status-stale')
    expect(status.className).not.toContain('text-status-fresh')
  })

  it('escalates to the Down colour when the capture is far past its cadence', () => {
    // Six days on a five-minute cadence is not merely late. The indicator has
    // three states because the product's freshness vocabulary has three, and
    // flattening Down into Stale here would be the same borrowing mistake in a
    // smaller size.
    datasets = [
      dataset({ lastUpdatedAt: new Date(NOW - 6 * 86_400_000).toISOString(), status: 'stale' }),
    ]
    render()

    const status = screen.getByText(/ago/i)
    expect(status.className).toContain('text-destructive')
  })

  it('stays green when the data underneath really is fresh', () => {
    datasets = [dataset()]
    render()

    const status = screen.getByText(/ago/i)
    expect(status.className).toContain('text-status-fresh')
  })

  it('claims nothing when the query resolves to no dataset', () => {
    // Fails closed, like the KPI badge: a bare timestamp and no icon beats
    // asserting a freshness nothing supports.
    datasets = []
    const { container } = render()

    expect(screen.getByText(/ago/i)).toBeInTheDocument()
    expect(container.querySelector('svg')).toBeNull()
    expect(container.innerHTML).not.toContain('text-status-fresh')
  })

  it('renders nothing before the parent clock has ticked', () => {
    // now === null is the server and hydrating render. Reading Date.now() here
    // would be an impure render and a hydration mismatch.
    datasets = [dataset()]
    const { container } = render(null)

    expect(container).toBeEmptyDOMElement()
  })
})
