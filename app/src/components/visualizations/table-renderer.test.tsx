import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import { renderWithProviders as render } from '@/test/utils'
import { TableRenderer } from './table-renderer'

function viz(options: Record<string, unknown> = {}): MockVisualization {
  return {
    id: 1, type: 'TABLE', name: 'Test table', description: '',
    options, created_at: '2026-07-21T00:00:00Z', updated_at: '2026-07-21T00:00:00Z',
  }
}

const oneNumber: QueryResultData = {
  columns: [{ name: 'stations', friendly_name: 'stations', type: 'integer' }],
  rows: [{ stations: 222 }],
}

describe('TableRenderer single-cell result', () => {
  it('shows a lone number as a counter, without the grid chrome', () => {
    render(<TableRenderer visualization={viz()} data={oneNumber} />)

    expect(screen.getByText('222')).toBeInTheDocument()
    expect(screen.getByText('stations')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Search results...')).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('uses the column title from the table options as the label', () => {
    render(
      <TableRenderer
        visualization={viz({ columns: [{ name: 'stations', title: 'Stations covered', order: 0, visible: true }] })}
        data={oneNumber}
      />,
    )

    expect(screen.getByText('Stations covered')).toBeInTheDocument()
  })

  it('keeps the grid for a lone string cell, which can be a paragraph', () => {
    render(
      <TableRenderer
        visualization={viz()}
        data={{
          columns: [{ name: 'note', friendly_name: 'note', type: 'string' }],
          rows: [{ note: 'the feed returned a short roster' }],
        }}
      />,
    )

    expect(screen.getByRole('table')).toBeInTheDocument()
  })

  it('keeps the grid once there is more than one cell', () => {
    render(
      <TableRenderer
        visualization={viz()}
        data={{
          columns: [{ name: 'stations', friendly_name: 'stations', type: 'integer' }],
          rows: [{ stations: 222 }, { stations: 221 }],
        }}
      />,
    )

    expect(screen.getByRole('table')).toBeInTheDocument()
  })
})
