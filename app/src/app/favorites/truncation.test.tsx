// Favorites are found by filtering the query and dashboard lists this page
// read. When that read stops at the page cap, an account with favorites past
// the cap looks exactly like an account with none, and the empty state used to
// swallow the warning that would have told them apart.
import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/utils'

const empty = { count: 0, results: [] as unknown[], truncated: true }

vi.mock('@/hooks/use-queries', () => ({
  useFavoriteQueries: () => ({ data: empty, isLoading: false }),
}))
vi.mock('@/hooks/use-dashboards', () => ({
  useFavoriteDashboards: () => ({ data: empty, isLoading: false }),
}))

import FavoritesPage from './page'

describe('FavoritesPage when the read was cut short', () => {
  it('warns even though it has nothing to list', async () => {
    renderWithProviders(<FavoritesPage />)

    expect(await screen.findByRole('status')).toHaveTextContent(/some favorites may not be shown/i)
  })

  it('does not tell the user they have starred nothing', async () => {
    renderWithProviders(<FavoritesPage />)

    expect(screen.queryByText(/nothing starred yet/i)).not.toBeInTheDocument()
    expect(await screen.findByText(/there are more it did not read/i)).toBeInTheDocument()
  })
})
