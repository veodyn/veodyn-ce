// The community half of Home. The registry is stubbed EMPTY here, so what this
// covers is what a build with no feature package renders, exercised that way
// rather than merely written as though it were.
//
// The composed case (Home mounts the KPI feature's notable-changes strip, and
// a hub counter naming a mover appears in it) is
// src/components/kpi/home-page-strip.test.tsx, which ships with the KPI
// feature. It drives this same page with the real registry.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/utils'
import * as useCatalogModule from '@/hooks/use-catalog'
import type { Dataset } from '@/types/catalog'

vi.mock('@/features/generated-registry', () => ({ FEATURES: {} }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/hooks/use-queries', () => ({
  useFavoriteQueries: () => ({ data: { results: [] } }),
  useRecentQueries: () => ({ data: { results: [] } }),
}))
vi.mock('@/hooks/use-dashboards', () => ({
  useFavoriteDashboards: () => ({ data: { results: [] } }),
}))
vi.mock('@/components/home/assistant-widget', () => ({
  AssistantWidget: () => null,
}))
// The notable-changes strip reads useCatalog for the freshness it can compute
// on its own; see notable-changes-strip.test.tsx for that component's own
// coverage. Mocked to an empty baseline so the strip stays absent by default
// and one test below can prove it appears when there is something to show.
vi.mock('@/hooks/use-catalog', () => ({
  useDomainHubs: vi.fn(() => ({ data: [] })),
  useCatalog: vi.fn(() => ({ data: [] })),
}))
const useDomainHubsSpy = vi.mocked(useCatalogModule.useDomainHubs)
const useCatalogSpy = vi.mocked(useCatalogModule.useCatalog)

import HomePage from '@/app/page'

function renderHome() {
  return renderWithProviders(<HomePage />)
}

const dataset: Dataset = {
  id: 'fresh-feed',
  name: 'Freshest Feed',
  description: '',
  domain: null,
  schema: [],
  freshness: { lastUpdatedAt: '2026-07-22T06:00:00Z', status: 'fresh' },
  coverage: { start: '2020-01-01T00:00:00Z', end: '2026-07-22T00:00:00Z' },
  rowCount: 100,
  sources: [],
  tags: [],
  sampleQueryId: null,
}

// Back to the empty baseline the vi.mock factories set, so a test that seeds
// notable data cannot decide what the next one sees.
afterEach(() => {
  useDomainHubsSpy.mockReturnValue({ data: [] } as unknown as ReturnType<
    typeof useCatalogModule.useDomainHubs
  >)
  useCatalogSpy.mockReturnValue({ data: [] } as unknown as ReturnType<
    typeof useCatalogModule.useCatalog
  >)
})

describe('HomePage', () => {
  it('renders a serif greeting with the configured brand name', () => {
    renderHome()
    const heading = screen.getByRole('heading', { name: /Veodyn/ })
    expect(heading).toHaveClass('font-display')
  })

  it('renders the omnisearch input shell', () => {
    renderHome()
    expect(screen.getByLabelText('Omnisearch')).toBeInTheDocument()
  })

  it('no longer renders the removed marketing-card grid', () => {
    renderHome()
    expect(screen.queryByText('Freeway Systems')).not.toBeInTheDocument()
    expect(screen.queryByText('Data Exchange Features')).not.toBeInTheDocument()
  })

  it('does not render the notable-changes strip when there is no notable data', () => {
    renderHome()
    expect(screen.queryByText('Notable changes')).not.toBeInTheDocument()
  })

  // What a community build shows in that section: freshness, which is the one
  // thing it can compute without a KPI feature. Asserted through Home rather
  // than through the strip alone, because the thing being pinned is that Home
  // still HAS the section when nothing fills the slot.
  it('renders the strip with what the community can compute when the catalog has datasets', () => {
    useCatalogSpy.mockReturnValue({ data: [dataset] } as unknown as ReturnType<
      typeof useCatalogModule.useCatalog
    >)

    renderHome()

    expect(screen.getByText('Notable changes')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Freshest Feed/ })).toHaveAttribute(
      'href',
      '/data/dataset/fresh-feed'
    )
  })
})
