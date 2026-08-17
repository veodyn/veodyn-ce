// The community Notable changes strip: the section, and Freshness, which is
// what this build can compute without a KPI or an alert.
//
// The full strip the KPI feature contributes through the home.notableChanges
// slot (movers off live KPIs, plus breaches) is covered in
// components/kpi/home-notable-changes.test.tsx, which also asserts the composed
// path through the real registry.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders, resetStores } from '@/test/utils'
import { useMockDataStore } from '@/stores/mock-data-store'
import type { DomainHub, Dataset } from '@/types/catalog'
import type { MockAlert } from '@/lib/mock-data'
import { NotableChangesStrip } from './notable-changes-strip'

vi.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => true }))

const seededDatasets: Dataset[] = [
  {
    id: 'fresh-feed',
    name: 'Freshest Feed',
    description: 'A very fresh feed',
    domain: null,
    schema: [],
    freshness: { lastUpdatedAt: '2026-07-22T06:00:00Z', status: 'fresh' },
    coverage: { start: '2020-01-01T00:00:00Z', end: '2026-07-22T00:00:00Z' },
    rowCount: 100,
    sources: [],
    tags: [],
    sampleQueryId: null,
    origin: 'capture',
    writable: false,
  },
  {
    id: 'stale-feed',
    name: 'Stalest Feed',
    description: 'A very stale feed',
    domain: null,
    schema: [],
    freshness: { lastUpdatedAt: '2025-01-01T00:00:00Z', status: 'stale' },
    coverage: { start: '2020-01-01T00:00:00Z', end: '2025-01-01T00:00:00Z' },
    rowCount: 100,
    sources: [],
    tags: [],
    sampleQueryId: null,
    origin: 'capture',
    writable: false,
  },
]

let originalState: { domainHubs: DomainHub[]; datasets: Dataset[]; alerts: MockAlert[] }

beforeEach(() => {
  const { domainHubs, datasets, alerts } = useMockDataStore.getState()
  originalState = { domainHubs, datasets, alerts }
})

afterEach(() => {
  resetStores()
  useMockDataStore.setState(originalState)
})

describe('NotableChangesStrip', () => {
  // Asserted synchronously, before the slot could have loaded, which is both
  // the fallback path and what a community build renders forever.
  it('renders the heading and the freshest and stalest datasets, each with a FreshnessBadge', async () => {
    useMockDataStore.setState({ domainHubs: [], datasets: seededDatasets, alerts: [] })

    renderWithProviders(<NotableChangesStrip />)

    expect(await screen.findByText('Notable changes')).toBeInTheDocument()

    const freshestLink = screen.getByRole('link', { name: /Freshest Feed/i })
    expect(freshestLink).toHaveAttribute('href', '/data/dataset/fresh-feed')
    expect(screen.getByText('Fresh')).toBeInTheDocument()

    const stalestLink = screen.getByRole('link', { name: /Stalest Feed/i })
    expect(stalestLink).toHaveAttribute('href', '/data/dataset/stale-feed')
    expect(screen.getByText('Stale')).toBeInTheDocument()
  })

  it('renders nothing when there are no movers, no datasets, and no breaches', () => {
    useMockDataStore.setState({ domainHubs: [], datasets: [], alerts: [] })

    const { container } = renderWithProviders(<NotableChangesStrip />)

    expect(container).toBeEmptyDOMElement()
  })
})
