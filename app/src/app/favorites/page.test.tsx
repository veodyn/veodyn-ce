// The nav item existed, the favorite toggles worked, Home rendered two
// favorites panels, and the destination named after the feature was a 404.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderWithProviders, resetStores } from '@/test/utils'
import { featureList } from '@/features'
import { useMockDataStore } from '@/stores/mock-data-store'
import type { FeatureDescriptor } from '@/features/types'
import FavoritesPage from './page'

// One made-up feature, and deliberately not one this tree ships.
//
// Two of the cases below are about a mechanism: the page derives what can be
// starred, and what to link to, from the descriptors rather than from a list
// written into it. Run against whatever registry a build happens to hold, they
// said nothing in a build with no feature packages and quietly re-asserted the
// packages' own contents in a build that had them. Against the registry below
// they say the same thing in either tree, and the labels are invented precisely
// so that a page which passed by naming something real would fail here.
//
// The feature contributes two nav rows on purpose: only the library one names a
// shelf of starrable objects, and the admin one has to stay out of the empty
// state.
//
// `vi.hoisted` because the two mocks below share it and a mock factory runs
// before this module's own bindings exist. The icon is never rendered by
// anything under test here, so it is a stand-in rather than a real one.
const mockRegistry = vi.hoisted(() => {
  const icon = (() => null) as unknown as import('lucide-react').LucideIcon
  const registry: Record<string, FeatureDescriptor> = {
    gadgets: {
      id: 'gadgets',
      nav: [
        { label: 'Gadgets', href: '/gadgets', icon, section: 'library' },
        { label: 'Gadget Links', href: '/admin/gadget-links', icon, section: 'admin' },
      ],
      routes: [],
      searchType: { type: 'gadget', label: 'Gadgets', noun: 'gadget', icon },
      // Renders nothing, because none of these cases are about what a section
      // looks like. What matters is that a section EXISTS to be filled.
      slots: { 'favorites.section': async () => ({ default: () => null }) },
    },
  }
  return registry
})

// Two seams, because the page reads the registry through both. `featureList` is
// passed the stub the way its own signature invites (the registry is its
// optional final parameter); the slot renderers and the favoritable kinds read
// the generated module directly, so that is stubbed as the module it is.
vi.mock('@/features', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features')>()
  return {
    ...actual,
    FEATURES: mockRegistry,
    featureList: (registry = mockRegistry) => actual.featureList(registry),
  }
})
vi.mock('@/features/generated-registry', () => ({ FEATURES: mockRegistry }))

// resetStores clears auth and access grants and nothing else, so a case that
// stars something has to put the sidecar list back itself or the next case
// starts on whatever it left. Captured before any test runs.
const PRISTINE_FAVORITES = useMockDataStore.getState().favorites

afterEach(() => {
  resetStores()
  useMockDataStore.setState({ favorites: PRISTINE_FAVORITES })
})

function setFavorites({ queries, dashboards }: { queries: number[]; dashboards: number[] }) {
  const store = useMockDataStore.getState()
  useMockDataStore.setState({
    queries: store.queries.map((q) => ({ ...q, is_favorite: queries.includes(q.id) })),
    dashboards: store.dashboards.map((d) => ({ ...d, is_favorite: dashboards.includes(d.id) })),
  })
}

describe('FavoritesPage', () => {
  it('lists the starred queries and dashboards, in their own sections', async () => {
    setFavorites({ queries: [1], dashboards: [1] })
    const { queries, dashboards } = useMockDataStore.getState()

    renderWithProviders(<FavoritesPage />)

    const queriesSection = await screen.findByRole('region', { name: 'Queries' })
    expect(await within(queriesSection).findByText(queries[0].name)).toBeInTheDocument()

    const dashboardsSection = screen.getByRole('region', { name: 'Dashboards' })
    expect(await within(dashboardsSection).findByText(dashboards[0].name)).toBeInTheDocument()
  })

  it('leaves out what is not starred', async () => {
    const { queries } = useMockDataStore.getState()
    setFavorites({ queries: [queries[0].id], dashboards: [] })

    renderWithProviders(<FavoritesPage />)

    expect(await screen.findByText(queries[0].name)).toBeInTheDocument()
    expect(screen.queryByText(queries[1].name)).not.toBeInTheDocument()
  })

  it('says what to do when nothing is starred, rather than showing two empty tables', async () => {
    setFavorites({ queries: [], dashboards: [] })

    renderWithProviders(<FavoritesPage />)

    expect(await screen.findByText(/Nothing starred yet/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Queries' })).toHaveAttribute('href', '/queries')
    expect(screen.getByRole('link', { name: 'Dashboards' })).toHaveAttribute('href', '/dashboards')
  })

  // The other half of the same sentence, and the reason it is a separate case:
  // the contributed link is not written in the page. It is the nav row of a
  // feature that fills favorites.section, and the registry it is read from is
  // the stub at the top of this file, so what is pinned is the derivation and
  // not the presence of any particular package. The list is asserted
  // EXHAUSTIVELY, which is the half that says a build offers no link to a
  // destination it does not have: a stray href here is a 404 handed to someone
  // with nothing starred.
  it('names the starrable kinds the installed features contribute, from their own nav rows', async () => {
    setFavorites({ queries: [], dashboards: [] })

    renderWithProviders(<FavoritesPage />)

    await screen.findByText(/Nothing starred yet/i)
    const expected = featureList()
      .filter((feature) => feature.slots?.['favorites.section'] !== undefined)
      .flatMap((feature) => feature.nav.filter((row) => row.section === 'library'))
    expect(expected.length).toBeGreaterThan(0)
    for (const row of expected) {
      expect(screen.getByRole('link', { name: row.label })).toHaveAttribute('href', row.href)
    }
    // The two community shelves, then the contributed rows, and nothing else.
    // The admin row the same feature contributes is a console over links rather
    // than a shelf of starrable objects, so it must not appear.
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/queries',
      '/dashboards',
      ...expected.map((row) => row.href),
    ])
  })

  // The page counts starred sidecar IDS now, not resolved rows: the sections
  // that turn an id into a row arrive through the favorites.section slot, so it
  // can no longer see how many of them there will be. The kind and the id below
  // are the stub registry's, and naming no real object kind is the point: what
  // is pinned is that a star belonging to SOME contributed section keeps the
  // page from claiming the shelf is empty.
  it('does not claim nothing is starred while a sidecar star is waiting for its section', async () => {
    setFavorites({ queries: [], dashboards: [] })
    useMockDataStore.getState().toggleVeodynFavorite('gadget', 'a-star-this-page-cannot-resolve')

    renderWithProviders(<FavoritesPage />)

    // Waited on a section that DOES arrive, so the absence below is read after
    // the page has settled rather than during its first paint. The wrong
    // answer this guards against is a page that says the shelf is empty and
    // then puts a table underneath it once the contributed chunk lands.
    expect(await screen.findByRole('region', { name: 'Queries' })).toBeInTheDocument()
    expect(screen.queryByText(/Nothing starred yet/i)).not.toBeInTheDocument()
  })

  it('renders the empty state through the shared primitive, keeping its card chrome', async () => {
    setFavorites({ queries: [], dashboards: [] })

    renderWithProviders(<FavoritesPage />)

    // The empty state moved onto NoData, which only gets its bg-card chrome
    // when `card` is passed. Walking up from the message text to the
    // outermost NoData wrapper (not just its nearest ancestor div) guards
    // against a swap that silently drops the card look this page always had.
    const message = await screen.findByText(/Nothing starred yet/i)
    const empty = message.closest('[class*="rounded-lg"]')
    expect(empty?.className).toContain('bg-card')
  })
})
