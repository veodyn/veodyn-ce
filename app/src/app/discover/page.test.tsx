import { afterEach, describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders, resetStores } from '@/test/utils'
import { useMockDataStore } from '@/stores/mock-data-store'
import type { MockDashboard } from '@/lib/mock-data'
import DiscoverPage from './page'

function dash(over: Partial<MockDashboard>): MockDashboard {
  return {
    id: 1,
    name: 'Board',
    is_favorite: false,
    is_archived: false,
    updated_at: '2020-01-01T00:00:00Z',
    tags: [],
    widgets: [],
    ...over,
  } as MockDashboard
}

afterEach(() => resetStores())

describe('DiscoverPage', () => {
  it('ranks favorites first, links to each object, and marks favorites', async () => {
    useMockDataStore.setState({
      dashboards: [
        dash({ id: 1, name: 'Starred Board', is_favorite: true, updated_at: '2024-01-01T00:00:00Z' }),
        dash({ id: 2, name: 'Plain Board', is_favorite: false, updated_at: '2026-01-01T00:00:00Z' }),
      ],
      queries: [],
    })

    renderWithProviders(<DiscoverPage />)

    expect(screen.getByRole('heading', { name: 'Discover' })).toBeInTheDocument()

    const links = await screen.findAllByRole('link')
    // The favorite ranks above the more-recent non-favorite.
    expect(links[0]).toHaveTextContent('Starred Board')
    expect(links[0]).toHaveAttribute('href', '/dashboards/1')
    expect(links[1]).toHaveTextContent('Plain Board')

    // The favorite carries a non-color-alone favorite marker.
    expect(screen.getByLabelText('Favorite')).toBeInTheDocument()
  })

  it('pads the card horizontally so content does not touch the border', async () => {
    useMockDataStore.setState({
      dashboards: [dash({ id: 1, name: 'Starred Board', is_favorite: true })],
      queries: [],
    })

    renderWithProviders(<DiscoverPage />)

    // Card supplies py-4 but no horizontal padding of its own: px-4 lives on
    // CardHeader/CardContent, which this page does not use. Without it the
    // icon and the right-aligned timestamp sit flush against the border, which
    // reads as the rightmost column being clipped.
    const card = (await screen.findAllByRole('link'))[0].querySelector('[data-slot="card"]')
    expect(card).toHaveClass('px-4')
  })
})
