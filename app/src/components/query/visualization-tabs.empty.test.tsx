// The panel a query that has never been run shows. Split from
// visualization-tabs.test.tsx, which sits at the file-size limit.
//
// The state used to be a single line of text telling the reader to run the
// query, with nothing on it to run the query: the only Run control is in the
// page header, which is off screen as soon as the query is long enough to
// scroll. So the instruction lived in the one place that could not act on it.
import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import type { MockVisualization } from '@/lib/mock-data'
import { VisualizationTabs } from './visualization-tabs'

const tableViz: MockVisualization = {
  id: 2,
  type: 'TABLE',
  name: 'Table View',
  description: '',
  options: {},
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

describe('VisualizationTabs with no result yet', () => {
  it('runs the query from the empty state', async () => {
    const user = userEvent.setup()
    const onRun = vi.fn()
    renderWithProviders(
      <VisualizationTabs visualizations={[tableViz]} queryResult={null} onRun={onRun} />
    )

    await user.click(screen.getByRole('button', { name: 'Run query' }))

    expect(onRun).toHaveBeenCalledTimes(1)
  })

  it('cannot be clicked a second time into a duplicate run', async () => {
    const user = userEvent.setup()
    const onRun = vi.fn()
    renderWithProviders(
      <VisualizationTabs visualizations={[tableViz]} queryResult={null} onRun={onRun} isRunning />
    )

    const run = screen.getByRole('button', { name: 'Run query' })
    expect(run).toBeDisabled()
    await user.click(run)
    expect(onRun).not.toHaveBeenCalled()
    // And it says which of the two things is true, rather than going on asking
    // for a run that is already under way.
    expect(screen.getByText('Running the query…')).toBeInTheDocument()
    expect(screen.queryByText('Run the query to see results')).toBeNull()
  })

  // The editor mounts these tabs only once a run has produced a result, so it
  // passes no onRun. A button there would sit beside the editor's own Run,
  // wired to nothing.
  it('offers no button to a parent that did not supply one', () => {
    renderWithProviders(<VisualizationTabs visualizations={[tableViz]} queryResult={null} />)

    expect(screen.getByText('Run the query to see results')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Run query' })).toBeNull()
  })
})
