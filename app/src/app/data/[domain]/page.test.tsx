import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import { renderWithProviders, resetStores } from '@/test/utils'
import { useMockDataStore } from '@/stores/mock-data-store'
import * as useCatalogModule from '@/hooks/use-catalog'
import { mockDashboards, mockDatasets, mockDomainHubs } from '@/lib/mock-data'
import { required } from '@/lib/required'
import DomainHubPage from './page'

// Partial mock: wrap the real useDomainHub in a vi.fn so a single test can
// force an error state, while every other test still exercises the real
// hook reading from the mock data store.
vi.mock('@/hooks/use-catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-catalog')>()
  return { ...actual, useDomainHub: vi.fn(actual.useDomainHub) }
})
const useDomainHubSpy = vi.mocked(useCatalogModule.useDomainHub)

afterEach(async () => {
  resetStores()
  // DomainHubPage calls useDomainHub, useCatalog, and useDashboards on every
  // render; useCatalog/useDashboards resolve asynchronously and trigger a
  // second render, so a stray `mockReturnValueOnce` on useDomainHub would
  // make that second render fall through to the real (hook-bearing)
  // implementation and break React's hooks-order invariant. Restore the
  // pass-through default after every test so only the error test (which sets
  // a persistent mockReturnValue for its own duration) sees a mocked value.
  const actual = await vi.importActual<typeof import('@/hooks/use-catalog')>('@/hooks/use-catalog')
  useDomainHubSpy.mockImplementation(actual.useDomainHub)
})

// The instance config is the registry of domains, so a hub renders only for a
// configured key. The neutral test config declares none, which would take every
// test below down the not-found branch.
const CONFIGURED_DOMAINS = [
  { key: 'transit', label: 'Transit' },
  { key: 'freeway', label: 'Freeways' },
]

async function renderPage(domain: string, domains = CONFIGURED_DOMAINS) {
  // DomainHubPage reads `params` via React's `use()`, which suspends on mount
  // even for an already-resolved promise (a native Promise always defers its
  // .then callback to a microtask). Wrapping the render in an awaited act()
  // lets that microtask (and the Suspense retry it triggers) flush before we
  // assert (see dashboards/[dashboardId]/dashboard-title.test.tsx).
  await act(async () => {
    renderWithProviders(<DomainHubPage params={Promise.resolve({ domain })} />, {
      config: { domains },
    })
  })
}

// Read off the active pack rather than hardcoded to one demo pack's labels
// and names, so this file passes under either.
const transitHub = required(mockDomainHubs.find((h) => h.key === 'transit'), 'the transit hub')
const transitCounter = required(transitHub.counters[0], 'a counter on the transit hub')
const transitDatasetNames = transitHub.datasetIds.map(
  (id) => required(mockDatasets.find((d) => d.id === id), `dataset ${id}`).name
)
const overviewDashboard = required(
  mockDashboards.find((d) => d.id === transitHub.dashboardIds[0]),
  "the transit hub's first dashboard"
)
const secondDashboard = required(
  mockDashboards.find((d) => d.id === transitHub.dashboardIds[1]),
  "the transit hub's second dashboard"
)

describe('DomainHubPage', () => {
  it('renders the hub label, a counter, and a DatasetCard per dataset in hub.datasetIds', async () => {
    await renderPage('transit')

    const heading = await screen.findByText(transitHub.label)
    expect(heading).toHaveClass('font-display')

    // Counter row: a label and its value.
    expect(screen.getByText(transitCounter.label)).toBeInTheDocument()
    expect(screen.getByText(transitCounter.value.toLocaleString())).toBeInTheDocument()

    // Every dataset id in the transit hub resolves to a rendered DatasetCard.
    for (const name of transitDatasetNames) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
  })

  it('renders the hub dashboards as links to /dashboards/<id>', async () => {
    await renderPage('transit')
    await screen.findByText(transitHub.label)

    const overviewLink = screen.getByRole('link', { name: new RegExp(overviewDashboard.name, 'i') })
    expect(overviewLink).toHaveAttribute('href', `/dashboards/${overviewDashboard.id}`)

    const secondLink = screen.getByRole('link', { name: new RegExp(secondDashboard.name, 'i') })
    expect(secondLink).toHaveAttribute('href', `/dashboards/${secondDashboard.id}`)
  })

  it('renders a not-found state for an unknown domain key', async () => {
    await renderPage('does-not-exist')

    expect(await screen.findByText(/domain not found/i)).toBeInTheDocument()
  })

  it('never seeds a domain hub with key "dataset" (the static /data/dataset route must win)', () => {
    const { domainHubs } = useMockDataStore.getState()
    expect(domainHubs.length).toBeGreaterThan(0)
    for (const hub of domainHubs) {
      expect(hub.key).not.toBe('dataset')
    }
  })

  it('renders a link for every hub dashboardId, even one not in the loaded dashboards page', async () => {
    const original = useMockDataStore.getState().domainHubs
    useMockDataStore.setState({
      domainHubs: original.map((hub) =>
        hub.key === 'transit' ? { ...hub, dashboardIds: [...hub.dashboardIds, 999] } : hub
      ),
    })

    try {
      await renderPage('transit')
      await screen.findByText(transitHub.label)

      const fallbackLink = screen.getByRole('link', { name: /dashboard 999/i })
      expect(fallbackLink).toHaveAttribute('href', '/dashboards/999')
    } finally {
      useMockDataStore.setState({ domainHubs: original })
    }
  })

  it('shows a distinct outage message when the domain hub query errors, not the not-found message', async () => {
    // A persistent mockReturnValue (not "once"): useCatalog/useDashboards
    // resolve asynchronously and trigger extra renders of DomainHubPage
    // within this test, and every one of them must see the same mocked,
    // hookless useDomainHub result (see the afterEach above for why).
    useDomainHubSpy.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    } as ReturnType<typeof useCatalogModule.useDomainHub>)

    await renderPage('transit')

    expect(
      await screen.findByText(/unable to load this domain\. the catalog service may be unavailable\./i)
    ).toBeInTheDocument()
    expect(screen.queryByText(/domain not found/i)).not.toBeInTheDocument()
  })

  it('refuses a key the instance config does not declare', async () => {
    // Every string under /data/ used to render as a real hub, because the
    // catalog service answers 200 with a hub built from the slug rather than
    // 404: it holds no registry of its own, so it cannot tell "not a domain"
    // from "a domain nothing is filed under yet". A typo, a renamed domain or a
    // stale bookmark all produced "this domain exists and is empty", which also
    // made the honest empty state unreadable.
    await renderPage('totally-made-up')

    expect(await screen.findByText(/domain not found/i)).toBeInTheDocument()
    // The fabricated page title-cased the slug, so this is the specific thing
    // that must not appear.
    expect(screen.queryByText('Totally Made Up')).not.toBeInTheDocument()
  })

  it('refuses every key when the instance configures no domains', async () => {
    // The reference instance ships no domains at all, so nothing under /data/
    // resolves there and the sidebar shows no domain rows either. The two now
    // agree; they did not before.
    await renderPage('transit', [])

    expect(await screen.findByText(/domain not found/i)).toBeInTheDocument()
  })
})
