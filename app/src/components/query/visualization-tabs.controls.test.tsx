import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/utils'
import type { MockVisualization } from '@/lib/mock-data'
import { VisualizationTabs } from './visualization-tabs'

vi.mock('./query-result-table', () => ({
  QueryResultTable: () => <div data-testid="viz">table panel</div>,
}))

vi.mock('@/components/visualizations/visualization-renderer', () => ({
  VisualizationRenderer: ({ visualization }: { visualization: MockVisualization }) => (
    <div data-testid="viz">{visualization.name}</div>
  ),
}))

const chartViz: MockVisualization = {
  id: 1,
  type: 'CHART',
  name: 'Chart View',
  description: '',
  options: { globalSeriesType: 'bar', columnMapping: { a: 'x' } },
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const tableViz: MockVisualization = {
  id: 2,
  type: 'TABLE',
  name: 'Table View',
  description: '',
  options: {},
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const queryResult = {
  data: {
    columns: [{ name: 'a', friendly_name: 'A', type: 'string' }],
    rows: [{ a: 'x' }],
  },
}

describe('VisualizationTabs edit control', () => {
  it('offers the edit control on a saved table, whose columns are its settings', () => {
    renderWithProviders(
      <VisualizationTabs visualizations={[tableViz]} queryResult={queryResult} queryId={5} />
    )
    expect(screen.getByRole('button', { name: 'Edit Table View' })).toBeInTheDocument()
  })

  it('never offers delete on a table, and offers it on a chart', () => {
    const { unmount } = renderWithProviders(
      <VisualizationTabs visualizations={[tableViz]} queryResult={queryResult} queryId={5} />
    )
    expect(screen.queryByRole('button', { name: 'More options for Table View' })).not.toBeInTheDocument()
    unmount()

    renderWithProviders(
      <VisualizationTabs visualizations={[chartViz]} queryResult={queryResult} queryId={5} />
    )
    expect(screen.getByRole('button', { name: 'More options for Chart View' })).toBeInTheDocument()
  })

  it('offers no edit, delete or add control to a viewer who cannot edit the query', () => {
    renderWithProviders(
      <VisualizationTabs visualizations={[chartViz]} queryResult={queryResult} queryId={5} canEdit={false} />
    )
    expect(screen.queryByRole('button', { name: /^Edit / })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^More options/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add visualization' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Publish Chart View' })).toBeInTheDocument()
  })

  it('offers no edit control for an unsaved query', () => {
    renderWithProviders(
      <VisualizationTabs visualizations={[chartViz]} queryResult={queryResult} />
    )
    expect(screen.queryByRole('button', { name: /^Edit / })).not.toBeInTheDocument()
  })
})
