/**
 * Which columns become dashboard filters.
 *
 * This bar was auto-deriving filters from any string column with a handful of
 * distinct values, which is a guess. Redash instead lets the query author say
 * so, by naming a column `route_id::filter`. When an author has said so, that
 * is the answer; the guess stays as the fallback for the dashboards that
 * already depend on it.
 */
import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import type { QueryResultData } from '@/lib/mock-data'
import { renderWithProviders } from '@/test/utils'
import { DashboardFilters } from './dashboard-filters'

function result(columns: string[], rows: Record<string, unknown>[]): QueryResultData {
  return {
    columns: columns.map((name) => ({ name, friendly_name: name, type: 'string' })),
    rows,
  }
}

const ROWS = [
  { 'route_id::filter': '12', depot: 'North', trips: 'a' },
  { 'route_id::filter': '40', depot: 'South', trips: 'b' },
]

describe('when the query author declared a filter', () => {
  it('offers that column and not the ones it merely could have guessed', () => {
    renderWithProviders(
      <DashboardFilters
        allResults={[result(['route_id::filter', 'depot', 'trips'], ROWS)]}
        onFilterChange={vi.fn()}
      />
    )

    expect(screen.getByLabelText('route_id')).toBeInTheDocument()
    expect(screen.queryByLabelText('depot')).not.toBeInTheDocument()
  })

  // The label comes off the name; printing the raw column would show the
  // instruction to the reader.
  it('labels it without the suffix', () => {
    renderWithProviders(
      <DashboardFilters allResults={[result(['route_id::filter'], ROWS)]} onFilterChange={vi.fn()} />
    )

    expect(screen.queryByText('route_id::filter')).not.toBeInTheDocument()
    expect(screen.getByLabelText('route_id')).toBeInTheDocument()
  })
})

describe('when nobody declared anything', () => {
  it('still guesses, the way it always has', () => {
    renderWithProviders(
      <DashboardFilters
        allResults={[
          result(
            ['depot'],
            [{ depot: 'North' }, { depot: 'South' }]
          ),
        ]}
        onFilterChange={vi.fn()}
      />
    )

    expect(screen.getByLabelText('depot')).toBeInTheDocument()
  })
})
