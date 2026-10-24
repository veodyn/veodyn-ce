import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { RunView } from '@/lib/chat/thread-model'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import { renderWithProviders } from '@/test/utils'
import { RunCard } from './run-card'

vi.mock('@veodyn/viz/components/visualizations/visualization-renderer', () => ({
  VisualizationRenderer: ({ visualization }: { visualization: { id: number; type: string } }) => (
    <div data-testid="drawn" data-id={visualization.id} data-type={visualization.type} />
  ),
}))

const SAVED_RUN: RunView = {
  callId: 's1',
  dataSourceId: 0,
  purpose: 'Route 720 live',
  sql: '',
  vizChoiceId: 'table',
  status: 'done',
  rowCount: 2,
  durationMs: null,
  error: null,
  saved: { queryId: 137, parameters: { route: 'R720' }, visualizationId: 1372 },
}

const DATA: QueryResultData = {
  columns: [{ name: 'vehicle', friendly_name: 'vehicle', type: 'string' }],
  rows: [{ vehicle: 'bus-14' }, { vehicle: 'bus-15' }],
}

const SAVED_VIZ: MockVisualization = {
  id: 1372,
  type: 'TRANSIT_LIVE_MAP',
  name: 'Vehicles',
  description: '',
  options: {},
  created_at: '',
  updated_at: '',
}

function renderCard(overrides: Partial<React.ComponentProps<typeof RunCard>> = {}) {
  const props = { run: SAVED_RUN, selected: false, onSelect: vi.fn(), onRerun: vi.fn(), ...overrides }
  renderWithProviders(<RunCard {...props} />)
  return props
}

describe('a saved-query run card', () => {
  it('draws_the_saved_visualization_from_the_rows', () => {
    renderCard({ data: DATA, visualization: SAVED_VIZ })
    expect(screen.getByTestId('drawn')).toHaveAttribute('data-id', '1372')
  })

  it('links_to_the_saved_query_instead_of_showing_sql', () => {
    renderCard({ data: DATA, visualization: SAVED_VIZ })
    expect(screen.getByRole('link', { name: 'Open the saved query' })).toHaveAttribute('href', '/queries/137')
    expect(screen.queryByRole('button', { name: 'SQL' })).not.toBeInTheDocument()
  })

  it('offers_a_rerun_with_no_data_source_because_the_saved_path_needs_none', async () => {
    const props = renderCard()
    await userEvent.click(screen.getByRole('button', { name: 'Run again to draw the chart' }))
    expect(props.onRerun).toHaveBeenCalled()
  })
})
