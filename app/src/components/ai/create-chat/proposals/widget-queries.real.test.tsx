// What happens against a real backend when the card writes a query.
//
// The behaviour under test is invisible in mock mode: a widget draws the
// query's last STORED result, and a query created a second ago has none, so
// without an execution the dashboard the analyst just asked for arrives with
// every new panel saying "No data". USE_REAL_API is a module constant, so it is
// forced for the whole file the way the other real-mode suites here do it.
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useWidgetQueries } from './use-widget-queries'
import * as execution from '@/services/redash/execution'
import type { DashboardWidgetProposal } from '@/types/ai-create'

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))
vi.mock('@/services/redash/execution', () => ({ executeSavedQuery: vi.fn() }))

const created = vi.hoisted(() => ({
  queries: [] as { name: string }[],
  visualizations: [] as { type: string; options: Record<string, unknown> }[],
}))

vi.mock('@/hooks/use-queries', () => ({
  useCreateQuery: () => ({
    mutateAsync: async (vars: { name: string }) => {
      created.queries.push(vars)
      return { id: 77, name: vars.name, visualizations: [{ id: 700, type: 'TABLE' }] }
    },
    isPending: false,
  }),
}))
vi.mock('@/hooks/use-visualizations', () => ({
  useCreateVisualization: () => ({
    mutateAsync: async (vars: { type: string; options: Record<string, unknown> }) => {
      created.visualizations.push(vars)
      return { id: 701 }
    },
    isPending: false,
  }),
}))

const executeSavedQuery = vi.mocked(execution.executeSavedQuery)

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const WRITTEN: DashboardWidgetProposal = {
  title: 'Rows per hour',
  queryId: null,
  visualizationId: null,
  vizChoiceId: null,
  newQuery: {
    name: 'Rows per hour',
    description: '',
    sql: 'SELECT 1',
    datasetTable: 'events',
    vizChoiceId: 'table',
    vizOptions: {},
  },
}

const EXISTING: DashboardWidgetProposal = {
  title: 'Ridership',
  queryId: 3,
  visualizationId: 300,
  vizChoiceId: null,
  newQuery: null,
}

// The shape the AI is asked to reach for a heatmap: two grouping columns and
// one aggregate, with the aggregate last. `hour` is an integer, so a "first
// numeric column is the measure" rule would colour the grid by time of day.
const STATION_BY_HOUR = {
  data: {
    columns: [
      { name: 'hour', friendly_name: 'hour', type: 'integer' },
      { name: 'name', friendly_name: 'name', type: 'string' },
      { name: 'avg_bikes', friendly_name: 'avg_bikes', type: 'float' },
    ],
    rows: [{ hour: 0, name: 'Main & 1st', avg_bikes: 9.8 }],
  },
}

function heatmapWidget(vizOptions: Record<string, unknown> = {}): DashboardWidgetProposal {
  return {
    title: 'Availability by station and hour',
    queryId: null,
    visualizationId: null,
    vizChoiceId: null,
    newQuery: {
      name: 'Availability by station and hour',
      description: '',
      sql: 'SELECT hour, name, avg(bikes) AS avg_bikes FROM bikes GROUP BY hour, name',
      datasetTable: 'bikes',
      vizChoiceId: 'heatmap',
      vizOptions,
    },
  }
}

beforeEach(() => {
  created.queries = []
  created.visualizations = []
  executeSavedQuery.mockReset()
  executeSavedQuery.mockResolvedValue({} as never)
})

describe('materialize', () => {
  it('runs a query it just wrote, so the panel is not empty on arrival', async () => {
    const { result } = renderHook(() => useWidgetQueries(), { wrapper })

    const out = await result.current.materialize([WRITTEN], 1)

    expect(created.queries.map((q) => q.name)).toEqual(['Rows per hour'])
    // maxAge 0 is a fresh run, not "any cached result is fine": there is no
    // cached result to accept.
    expect(executeSavedQuery).toHaveBeenCalledWith(77, { maxAge: 0 })
    expect(out.resolved[0]).toMatchObject({ queryId: 77, written: true })
  })

  it('does not run anything for a panel that names a query that exists', async () => {
    const { result } = renderHook(() => useWidgetQueries(), { wrapper })

    const out = await result.current.materialize([EXISTING], 1)

    expect(created.queries).toEqual([])
    expect(executeSavedQuery).not.toHaveBeenCalled()
    expect(out.resolved[0]).toMatchObject({ queryId: 3, visualizationId: 300, written: false })
  })

  it('configures the visualization from the result the run just returned', async () => {
    // The point of running BEFORE creating the visualization. A choice carries
    // only what makes it a heatmap, so this mapping can only have come from the
    // result: `avg_bikes` is the value because it is the last numeric column,
    // and `hour` is an axis despite being numeric.
    executeSavedQuery.mockResolvedValue(STATION_BY_HOUR as never)
    const { result } = renderHook(() => useWidgetQueries(), { wrapper })

    const out = await result.current.materialize([heatmapWidget()], 1)

    expect(created.visualizations).toHaveLength(1)
    expect(created.visualizations[0]).toMatchObject({
      type: 'HEATMAP',
      options: { columnMapping: { hour: 'x', name: 'y', avg_bikes: 'value' } },
    })
    // What the card renders locally has to be the same options that were saved,
    // or the panel on the card is configured differently from the dashboard's.
    expect(out.resolved[0].visualization?.options).toEqual(created.visualizations[0].options)
  })

  it('keeps the mapping the service authored over the one inferred here', async () => {
    // The service ran DESCRIBE on the statement and named the columns from the
    // result; this side only sees types and positions. The two disagree on
    // purpose here (axes swapped), so a merge that lost to the inference, or
    // never happened, shows up as the inferred mapping instead.
    executeSavedQuery.mockResolvedValue(STATION_BY_HOUR as never)
    const { result } = renderHook(() => useWidgetQueries(), { wrapper })
    const authored = { columnMapping: { name: 'x', hour: 'y', avg_bikes: 'value' } }

    await result.current.materialize([heatmapWidget(authored)], 1)

    expect(created.visualizations[0]).toMatchObject({ type: 'HEATMAP', options: authored })
  })

  it('still creates the visualization when the run fails, with the plain choice', async () => {
    // No result means nothing to infer from. The heatmap renderer falls back to
    // column order, which is what every AI-authored one relied on before, so an
    // unconfigured panel is the honest degradation rather than no panel.
    executeSavedQuery.mockRejectedValue(new Error('warehouse busy'))
    const { result } = renderHook(() => useWidgetQueries(), { wrapper })

    await result.current.materialize([heatmapWidget()], 1)

    expect(created.visualizations).toEqual([
      expect.objectContaining({ type: 'HEATMAP', options: {} }),
    ])
  })

  it('keeps the panel when the run fails, since the query still exists', async () => {
    executeSavedQuery.mockRejectedValue(new Error('warehouse busy'))
    const { result } = renderHook(() => useWidgetQueries(), { wrapper })

    const out = await result.current.materialize([WRITTEN], 1)

    // Reported nowhere on purpose: the query and its panel are both real, and
    // Refresh is on the widget.
    await waitFor(() => expect(out.resolved).toHaveLength(1))
    expect(out.failed).toEqual([])
  })
})
