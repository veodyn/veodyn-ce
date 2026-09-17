import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallView } from '@/lib/chat/thread-model'
import { renderWithProviders } from '@/test/utils'
import { DashboardCard } from './dashboard-card'
import { LibraryCard, MORE_FOUND, NOTHING_FOUND } from './library-card'
import { NEEDS_PARAMETERS, NEVER_RAN, SavedVizCard } from './saved-viz-card'
import { SavedVizPane } from './saved-viz-pane'

const hooks = vi.hoisted(() => ({ useQueryById: vi.fn(), useQueryResult: vi.fn() }))
const execution = vi.hoisted(() => ({ executeSavedQuery: vi.fn() }))

vi.mock('@/hooks/use-queries', () => ({ useQueryById: hooks.useQueryById }))
vi.mock('@/hooks/use-query-execution', () => ({ useQueryResult: hooks.useQueryResult }))
vi.mock('@/services/redash/execution', () => execution)
vi.mock('@/components/visualizations/visualization-renderer', () => ({
  VisualizationRenderer: ({ visualization }: { visualization: { name: string } }) => (
    <div data-testid="chart">{visualization.name}</div>
  ),
}))

const DATA = { columns: [{ name: 'n', type: 'integer', friendly_name: 'n' }], rows: [{ n: 1 }] }

function call(overrides: Partial<CallView>): CallView {
  return {
    callId: 'c1',
    tool: 'search_library',
    status: 'done',
    target: null,
    output: null,
    error: null,
    ...overrides,
  }
}

function savedQuery(overrides: Record<string, unknown> = {}) {
  return {
    id: 12,
    name: 'Trips by hour',
    query: 'SELECT hour, count() FROM trips',
    visualizations: [
      { id: 30, type: 'TABLE', name: 'Table', options: {} },
      { id: 31, type: 'CHART', name: 'Trips', options: {} },
    ],
    latest_query_data_id: 99,
    options: { parameters: [] },
    ...overrides,
  }
}

function withQuery(query: unknown, stored: unknown = { data: DATA, retrieved_at: '2026-09-17T06:00:00Z' }) {
  hooks.useQueryById.mockReturnValue({ data: query, isLoading: false })
  hooks.useQueryResult.mockReturnValue({ data: stored, isLoading: false })
}

const showCall = call({ tool: 'show_visualization', target: { queryId: 12, visualizationId: null } })

beforeEach(() => {
  vi.resetAllMocks()
})

describe('LibraryCard', () => {
  it('links each item and marks queries that never ran', () => {
    renderWithProviders(
      <LibraryCard
        call={call({
          output: {
            kind: 'library',
            ok: true,
            items: [
              { type: 'query', id: 12, name: 'Trips by hour', tags: ['bikeshare'], hasResult: false },
              { type: 'dashboard', id: 4, name: 'Bikeshare overview' },
            ],
            more: true,
          },
        })}
      />
    )
    expect(screen.getByRole('link', { name: 'Trips by hour' })).toHaveAttribute('href', '/queries/12')
    expect(screen.getByRole('link', { name: 'Bikeshare overview' })).toHaveAttribute('href', '/dashboards/4')
    expect(screen.getByText('never run')).toBeInTheDocument()
    expect(screen.getByText('bikeshare')).toBeInTheDocument()
    expect(screen.getByText(MORE_FOUND)).toBeInTheDocument()
  })

  it('says when nothing matched, and shows a failure', () => {
    const { rerender } = renderWithProviders(
      <LibraryCard call={call({ output: { kind: 'library', ok: true, items: [], more: false } })} />
    )
    expect(screen.getByText(NOTHING_FOUND)).toBeInTheDocument()
    rerender(<LibraryCard call={call({ status: 'failed', error: 'Not found, or not shared with the analyst.' })} />)
    expect(screen.getByText('Not found, or not shared with the analyst.')).toBeInTheDocument()
  })

  it('shows progress while the search runs', () => {
    renderWithProviders(<LibraryCard call={call({ status: 'running' })} />)
    expect(screen.getByText('Searching the library…')).toBeInTheDocument()
  })
})

describe('DashboardCard', () => {
  it('links the dashboard and lists its charts', () => {
    renderWithProviders(
      <DashboardCard
        call={call({
          tool: 'open_dashboard',
          output: {
            kind: 'dashboard',
            ok: true,
            dashboard: { id: 4, name: 'Bikeshare overview' },
            widgets: [{ title: 'Trips by hour', queryId: 12, visualizationId: 31, visualizationType: 'CHART' }],
            textWidgets: 2,
          },
        })}
      />
    )
    expect(screen.getByRole('link', { name: 'Bikeshare overview' })).toHaveAttribute('href', '/dashboards/4')
    expect(screen.getByRole('link', { name: 'Trips by hour' })).toHaveAttribute('href', '/queries/12')
    expect(screen.getByText('Plus 2 text boxes.')).toBeInTheDocument()
  })
})

describe('SavedVizCard', () => {
  it('draws the main chart from the stored result, with its age', () => {
    withQuery(savedQuery())
    const onSelect = vi.fn()
    renderWithProviders(<SavedVizCard call={showCall} selected={false} onSelect={onSelect} />)
    expect(hooks.useQueryResult).toHaveBeenCalledWith(99)
    expect(screen.getByTestId('chart')).toHaveTextContent('Trips')
    expect(screen.getByRole('link', { name: 'Trips by hour' })).toHaveAttribute('href', '/queries/12')
    expect(screen.getByText(/^Trips · as of /)).toBeInTheDocument()
    expect(execution.executeSavedQuery).not.toHaveBeenCalled()
  })

  it('draws the visualization the model settled on', () => {
    withQuery(savedQuery())
    const settled = {
      ...showCall,
      output: { kind: 'saved_visualization' as const, ok: true, visualization: { id: 30, name: 'Table', type: 'TABLE' } },
    }
    renderWithProviders(<SavedVizCard call={settled} selected={false} onSelect={vi.fn()} />)
    expect(screen.getByTestId('chart')).toHaveTextContent('Table')
  })

  it('refreshes a query without parameters only when asked', async () => {
    withQuery(savedQuery())
    execution.executeSavedQuery.mockResolvedValue({ id: 100, data: DATA, retrieved_at: '2026-09-17T07:00:00Z' })
    renderWithProviders(<SavedVizCard call={showCall} selected={false} onSelect={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(execution.executeSavedQuery).toHaveBeenCalledWith(12, { maxAge: 0 }))
  })

  it('offers Run for a query that never ran, and nothing for one with parameters', () => {
    withQuery(savedQuery({ latest_query_data_id: null }), null)
    const { unmount } = renderWithProviders(
      <SavedVizCard
        call={{ ...showCall, status: 'failed', error: 'no stored result' }}
        selected={false}
        onSelect={vi.fn()}
      />
    )
    expect(screen.getByText(NEVER_RAN)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument()
    unmount()
    const parameters = [{ name: 'start', title: 'Start', type: 'date', value: null }]
    withQuery(savedQuery({ latest_query_data_id: null, options: { parameters } }), null)
    renderWithProviders(<SavedVizCard call={showCall} selected={false} onSelect={vi.fn()} />)
    expect(screen.getByText(NEEDS_PARAMETERS)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Run|Refresh/ })).not.toBeInTheDocument()
  })

  it('shows the error when the query cannot be read', () => {
    withQuery(null, null)
    renderWithProviders(
      <SavedVizCard call={{ ...showCall, status: 'failed', error: 'Not found' }} selected={false} onSelect={vi.fn()} />
    )
    expect(screen.getByText('Not found')).toBeInTheDocument()
    expect(screen.queryByTestId('chart')).not.toBeInTheDocument()
  })

  it('opens beside the chat with the SQL', async () => {
    withQuery(savedQuery())
    const onSelect = vi.fn()
    renderWithProviders(<SavedVizCard call={showCall} selected={false} onSelect={onSelect} />)
    await userEvent.click(screen.getByRole('button', { name: 'Open beside the chat' }))
    expect(onSelect).toHaveBeenCalled()
    renderWithProviders(<SavedVizPane call={showCall} onClose={vi.fn()} />)
    expect(screen.getByRole('complementary', { name: 'Details: Trips by hour · Trips' })).toBeInTheDocument()
    expect(screen.getByText('SELECT hour, count() FROM trips')).toBeInTheDocument()
  })
})
