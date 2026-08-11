import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import { CohortRenderer } from './cohort-renderer'

function viz(options: Record<string, unknown>): MockVisualization {
  return { id: 1, type: 'COHORT', name: 'Cohort', description: '', options, created_at: '', updated_at: '' }
}

// Stages start at 1, not 0, so this fixture also exercises the observed
// (not zero-based) stage axis in the rendered headers.
const data: QueryResultData = {
  columns: [
    { name: 'date', friendly_name: 'date', type: 'string' },
    { name: 'stage', friendly_name: 'stage', type: 'integer' },
    { name: 'total', friendly_name: 'total', type: 'integer' },
    { name: 'value', friendly_name: 'value', type: 'integer' },
  ],
  rows: [
    { date: '2026-01-01', stage: 1, total: 100, value: 100 },
    { date: '2026-01-01', stage: 2, total: 100, value: 40 },
  ],
}

const fullOptions = { dateColumn: 'date', stageColumn: 'stage', totalColumn: 'total', valueColumn: 'value' }

describe('CohortRenderer', () => {
  it('degrades to a muted message when columns are unmapped', () => {
    render(<CohortRenderer visualization={viz({ dateColumn: 'date' })} data={data} />)
    expect(screen.getByText(/requires cohort, period, and value columns/i)).toBeInTheDocument()
  })

  it('does not render the grid when columns are unmapped', () => {
    render(<CohortRenderer visualization={viz({ dateColumn: 'date' })} data={data} />)
    expect(screen.queryByText('2026-01-01')).not.toBeInTheDocument()
  })

  it('renders stage-index header columns and a cohort key column, with no phantom stage 0', () => {
    render(<CohortRenderer visualization={viz(fullOptions)} data={data} />)
    expect(screen.getByText('Cohort')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('renders each cell as a percentage of the cohort total, not the raw count', () => {
    render(<CohortRenderer visualization={viz(fullOptions)} data={data} />)
    const fullRetention = screen.getByRole('img', { name: '2026-01-01 / period 1: 100 (100%)' })
    const partialRetention = screen.getByRole('img', { name: '2026-01-01 / period 2: 40 (40%)' })
    expect(fullRetention).toHaveTextContent('100%')
    expect(partialRetention).toHaveTextContent('40%')
  })

  it('renders a cohort row with color-mix cells from the sequential scale', () => {
    render(<CohortRenderer visualization={viz(fullOptions)} data={data} />)
    expect(screen.getByText('2026-01-01')).toBeInTheDocument()
    const filled = screen.getByRole('img', { name: '2026-01-01 / period 2: 40 (40%)' })
    expect(filled.getAttribute('style')).toContain('color-mix')
  })

  it('colors cells with different retention differently', () => {
    render(<CohortRenderer visualization={viz(fullOptions)} data={data} />)
    const fullRetention = screen.getByRole('img', { name: '2026-01-01 / period 1: 100 (100%)' })
    const partialRetention = screen.getByRole('img', { name: '2026-01-01 / period 2: 40 (40%)' })
    expect(fullRetention.getAttribute('style')).not.toBe(partialRetention.getAttribute('style'))
  })

  it('gives two cohorts the same color when they share the same retention ratio, regardless of size', () => {
    const twoCohorts: QueryResultData = {
      columns: data.columns,
      rows: [
        { date: '2026-01-01', stage: 1, total: 1000, value: 400 },
        { date: '2026-01-08', stage: 1, total: 10, value: 4 },
      ],
    }
    render(<CohortRenderer visualization={viz(fullOptions)} data={twoCohorts} />)
    const bigCohort = screen.getByRole('img', { name: '2026-01-01 / period 1: 400 (40%)' })
    const smallCohort = screen.getByRole('img', { name: '2026-01-08 / period 1: 4 (40%)' })
    expect(bigCohort.getAttribute('style')).toBe(smallCohort.getAttribute('style'))
  })

  it('renders a no-data cell without throwing when the cohort total is zero', () => {
    const zeroTotal: QueryResultData = {
      columns: data.columns,
      rows: [{ date: '2026-01-01', stage: 1, total: 0, value: 0 }],
    }
    const { container } = render(<CohortRenderer visualization={viz(fullOptions)} data={zeroTotal} />)
    const cell = container.querySelector('.aspect-square')
    expect(cell).not.toBeNull()
    expect(cell?.textContent).toBe('')
    expect(cell?.getAttribute('style')).toContain('var(--muted)')
  })

  it('names an empty cell too, rather than leaving a blank square a reader cannot place', () => {
    const zeroTotal: QueryResultData = {
      columns: data.columns,
      rows: [{ date: '2026-01-01', stage: 1, total: 0, value: 0 }],
    }
    render(<CohortRenderer visualization={viz(fullOptions)} data={zeroTotal} />)
    expect(screen.getByRole('img', { name: '2026-01-01 / period 1: no data' })).toBeInTheDocument()
  })

  it('renders a total column with the cohort total', () => {
    render(<CohortRenderer visualization={viz(fullOptions)} data={data} />)
    expect(screen.getByText('Total')).toBeInTheDocument()
    expect(screen.getByText('100')).toBeInTheDocument()
  })

  it('applies tabular numeral styling to cell values', () => {
    render(<CohortRenderer visualization={viz(fullOptions)} data={data} />)
    const filled = screen.getByRole('img', { name: '2026-01-01 / period 2: 40 (40%)' })
    expect(filled.className).toContain('tabular-nums')
  })

  it('degrades to the no-data message, not a broken grid, when the data has no rows', () => {
    const empty: QueryResultData = { columns: data.columns, rows: [] }
    render(<CohortRenderer visualization={viz(fullOptions)} data={empty} />)
    expect(screen.getByText(/requires cohort, period, and value columns/i)).toBeInTheDocument()
    expect(screen.queryByText('Total')).not.toBeInTheDocument()
  })

  it('never throws when required columns are missing entirely', () => {
    expect(() => render(<CohortRenderer visualization={viz({})} data={data} />)).not.toThrow()
  })

  it('carries no native title attribute, which is the tooltip the repo bans', () => {
    const { container } = render(<CohortRenderer visualization={viz(fullOptions)} data={data} />)
    expect(container.querySelectorAll('[title]')).toHaveLength(0)
  })

  it('explains a cell on hover, in a tooltip rather than a title', async () => {
    const user = userEvent.setup()
    render(<CohortRenderer visualization={viz(fullOptions)} data={data} />)
    const cell = screen.getByRole('img', { name: '2026-01-01 / period 2: 40 (40%)' })

    expect(screen.queryByText('2026-01-01 / period 2: 40 (40%)')).not.toBeInTheDocument()
    await user.hover(cell)
    await waitFor(() => {
      expect(screen.getByText('2026-01-01 / period 2: 40 (40%)')).toBeInTheDocument()
    })
  })

  it('reveals a truncated cohort key on hover', async () => {
    const user = userEvent.setup()
    render(<CohortRenderer visualization={viz(fullOptions)} data={data} />)

    expect(screen.getAllByText('2026-01-01')).toHaveLength(1)
    await user.hover(screen.getByText('2026-01-01'))
    await waitFor(() => {
      expect(screen.getAllByText('2026-01-01')).toHaveLength(2)
    })
  })
})
