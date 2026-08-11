import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { mockQueries } from '@/lib/mock-data'
import { server } from '@/test/msw/server'
import { renderWithProviders, resetStores } from '@/test/utils'
import DiscoverPage from './page'

// Discover promises "the most notable dashboards and queries across the org" and
// was calling the PAGED hooks, which fetch page_size 25. So the ranking saw at
// most the first 25 of each, in whatever order the backend returned them.
//
// The diagnostic case on the reference instance: favorites are the hard top tier
// in rankDiscover, so a favourited object should always surface. One favourited
// query never appeared, because it sat past row 25 and was never in the input
// set at all. The tiering worked; the read was short.
//
// Against the real API, because mock mode returns the whole array and merely
// labels it page_size 25, which is exactly how a 25-row cap survived unnoticed.
vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const TOTAL = 78
const FAVOURITE_NAME = 'Regional History'

// Favourited and last in the list, so it falls outside the first server page.
const library = Array.from({ length: TOTAL }, (_, i) => ({
  ...mockQueries[0],
  id: 3000 + i,
  name: i === TOTAL - 1 ? FAVOURITE_NAME : `Query ${String(i + 1).padStart(3, '0')}`,
  description: '',
  is_archived: false,
  is_draft: false,
  is_favorite: i === TOTAL - 1,
  updated_at: '2026-07-25T00:00:00Z',
}))

let queryPageSizes: number[] = []

beforeEach(() => {
  queryPageSizes = []
  server.use(
    http.get('/api/node/queries', ({ request }) => {
      const url = new URL(request.url)
      const page = Number(url.searchParams.get('page') ?? 1)
      const pageSize = Number(url.searchParams.get('page_size') ?? 25)
      queryPageSizes.push(pageSize)
      const start = (page - 1) * pageSize
      return HttpResponse.json({
        count: TOTAL,
        page,
        page_size: pageSize,
        results: library.slice(start, start + pageSize),
      })
    }),
    http.get('/api/node/dashboards', () =>
      HttpResponse.json({ count: 0, page: 1, page_size: 25, results: [] })
    )
  )
})

afterEach(() => resetStores())

describe('Discover reads the whole library', () => {
  it('surfaces a favourited query that sits past the first server page', async () => {
    renderWithProviders(<DiscoverPage />)

    // Favorites are the top tier, so this is first, not merely present.
    const links = await screen.findAllByRole('link')
    expect(links[0]).toHaveTextContent(FAVOURITE_NAME)
    expect(screen.getByLabelText('Favorite')).toBeInTheDocument()
  })

  it('asks for a full read rather than one 25-row page', async () => {
    renderWithProviders(<DiscoverPage />)
    await screen.findAllByRole('link')

    // fetchAllPages asks for 100 at a time. The paged hook asked for 25, which
    // is the whole defect, so the size on the wire is the thing to assert.
    expect(queryPageSizes.length).toBeGreaterThan(0)
    expect(queryPageSizes.every((size) => size > 25)).toBe(true)
  })

  it('finds a query the ranking never surfaced, which the old search could not', async () => {
    // VD-004 and VD-005 are two halves of one behaviour: filtering before
    // ranking is useless if the candidate list is the first 25 rows.
    //
    // Query 060 specifically, and not an early one. A first draft searched for
    // Query 002, which passed against the paged hooks too because row 2 is
    // inside the first server page. A term that the broken version can also find
    // proves nothing.
    const user = userEvent.setup()
    renderWithProviders(<DiscoverPage />)
    await screen.findAllByRole('link')

    await user.type(screen.getByLabelText('Search dashboards and queries'), 'Query 060')

    expect(await screen.findByText('Query 060')).toBeInTheDocument()
  })
})
