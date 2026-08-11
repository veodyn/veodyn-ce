// The page reader gives up at a cap, and the warning that says so was rendered
// inside the "we found some" branch. So the one case where an unread page is
// genuinely dangerous, finding nothing, was the case that showed no warning and
// stated "no query has a refresh schedule yet" as fact.
import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/utils'

const list = { count: 0, results: [] as unknown[], truncated: true }

vi.mock('@/hooks/use-queries', () => ({
  useAllQueries: () => ({ data: list, isLoading: false }),
}))

import SchedulesPage from './page'

describe('SchedulesPage when the read was cut short', () => {
  it('warns even though it has nothing to list', async () => {
    renderWithProviders(<SchedulesPage />)

    expect(await screen.findByRole('status')).toHaveTextContent(/some schedules may not be shown/i)
  })

  it('does not claim nothing is scheduled when it has not looked everywhere', async () => {
    renderWithProviders(<SchedulesPage />)

    expect(screen.queryByText(/no query has a refresh schedule yet/i)).not.toBeInTheDocument()
    expect(await screen.findByText(/there are more it did not read/i)).toBeInTheDocument()
  })
})
