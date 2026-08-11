import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import { DetailsRenderer } from './details-renderer'

function viz(options: Record<string, unknown> = {}): MockVisualization {
  return { id: 1, type: 'DETAILS', name: 'Details', description: '', options, created_at: '', updated_at: '' }
}

const columns: QueryResultData['columns'] = [
  { name: 'station_name', friendly_name: 'Station', type: 'string' },
  { name: 'city', friendly_name: 'City', type: 'string' },
  { name: 'boardings', friendly_name: 'Boardings', type: 'integer' },
]

function resultOf(names: string[]): QueryResultData {
  return {
    columns,
    rows: names.map((station_name, i) => ({ station_name, city: 'Central District', boardings: 100 + i })),
  }
}

const fourRows = resultOf(['Central Station', 'North Junction', 'Downtown Interchange', 'North Terminal'])

describe('DetailsRenderer', () => {
  it('renders one row as a field list', () => {
    render(<DetailsRenderer visualization={viz()} data={fourRows} />)

    expect(screen.getByText('Station')).toBeInTheDocument()
    expect(screen.getByText('Central Station')).toBeInTheDocument()
    expect(screen.getByText('Row 1 of 4')).toBeInTheDocument()
  })

  it('pages to the next row', async () => {
    const user = userEvent.setup()
    render(<DetailsRenderer visualization={viz()} data={fourRows} />)

    await user.click(screen.getByRole('button', { name: 'Next row' }))

    expect(screen.getByText('Row 2 of 4')).toBeInTheDocument()
    expect(screen.getByText('North Junction')).toBeInTheDocument()
  })

  // The defect: rowIndex outlived the result it was chosen in, so re-running a
  // query into a shorter result indexed past the end and the renderer reported
  // an empty state for a result that has rows.
  it('starts over at the first row when a re-run returns fewer rows than the current page', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<DetailsRenderer visualization={viz()} data={fourRows} />)

    await user.click(screen.getByRole('button', { name: 'Next row' }))
    await user.click(screen.getByRole('button', { name: 'Next row' }))
    await user.click(screen.getByRole('button', { name: 'Next row' }))
    expect(screen.getByText('Row 4 of 4')).toBeInTheDocument()

    rerender(<DetailsRenderer visualization={viz()} data={resultOf(['South Depot', 'West Depot'])} />)

    expect(screen.queryByText('No data to display.')).not.toBeInTheDocument()
    expect(screen.getByText('Row 1 of 2')).toBeInTheDocument()
    expect(screen.getByText('South Depot')).toBeInTheDocument()
  })

  it('starts over at the first row even when the new result is the same size', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<DetailsRenderer visualization={viz()} data={fourRows} />)

    await user.click(screen.getByRole('button', { name: 'Next row' }))
    expect(screen.getByText('Row 2 of 4')).toBeInTheDocument()

    rerender(<DetailsRenderer visualization={viz()} data={resultOf(['A', 'B', 'C', 'D'])} />)

    expect(screen.getByText('Row 1 of 4')).toBeInTheDocument()
    expect(screen.getByText('A')).toBeInTheDocument()
  })

  it('keeps the page when the same result re-renders, so an unrelated update is not a reset', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<DetailsRenderer visualization={viz()} data={fourRows} />)

    await user.click(screen.getByRole('button', { name: 'Next row' }))
    rerender(<DetailsRenderer visualization={viz({ columns: ['station_name'] })} data={fourRows} />)

    expect(screen.getByText('Row 2 of 4')).toBeInTheDocument()
  })

  it('shows the empty state for a result with no rows at all', () => {
    render(<DetailsRenderer visualization={viz()} data={{ columns, rows: [] }} />)

    expect(screen.getByText('No data to display.')).toBeInTheDocument()
  })

  it('hides the pager for a single-row result', () => {
    render(<DetailsRenderer visualization={viz()} data={resultOf(['Central Station'])} />)

    expect(screen.queryByRole('button', { name: 'Next row' })).not.toBeInTheDocument()
  })

  it('shows only the saved columns when the visualization names them', () => {
    render(<DetailsRenderer visualization={viz({ columns: ['station_name'] })} data={fourRows} />)

    expect(screen.getByText('Station')).toBeInTheDocument()
    expect(screen.queryByText('City')).not.toBeInTheDocument()
  })

  it('marks a null value rather than rendering an empty field', () => {
    const withNull: QueryResultData = { columns, rows: [{ station_name: 'Central Station', city: null, boardings: 1 }] }
    render(<DetailsRenderer visualization={viz()} data={withNull} />)

    expect(screen.getByText('null')).toBeInTheDocument()
  })
})
