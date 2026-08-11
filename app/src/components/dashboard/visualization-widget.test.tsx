import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders, resetStores } from '@/test/utils'
import { ConfigProvider } from '@/components/config/config-provider'
import { NEUTRAL_CONFIG, toClientConfig } from '@/lib/config-schema'
import { useMockDataStore } from '@/stores/mock-data-store'
import { mockQueries, mockQueryResults } from '@/lib/mock-data'
import type { MockDashboardWidget, MockQuery, MockQueryResult } from '@/lib/mock-data'
import type { Annotation } from '@/types/annotation'
import { VisualizationWidget } from './visualization-widget'

// The widget mounts the annotation dialog, which reads config to gate its AI
// "Suggest" affordance, so the tree needs a ConfigProvider. AI stays off.
const CONFIG = toClientConfig(NEUTRAL_CONFIG)

// ResponsiveContainer measures its host via getBoundingClientRect in a
// useEffect and won't render its children (or a ReferenceLine placed under
// it) until it sees a positive size; jsdom always reports an all-zero rect.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 800,
    height: 400,
    top: 0,
    left: 0,
    bottom: 400,
    right: 800,
    x: 0,
    y: 0,
    toJSON() {
      return this
    },
  } as DOMRect)
})

afterEach(() => {
  vi.restoreAllMocks()
  resetStores()
  useMockDataStore.setState({ queries: [...mockQueries], queryResults: { ...mockQueryResults } })
})

const QUERY_ID = 90001
const DATA_ID = 90002

function baseMockQuery(): MockQuery {
  return {
    id: QUERY_ID,
    name: 'Ridership by year',
    description: '',
    query: 'select * from ridership_by_year',
    data_source_id: 1,
    schedule: null,
    tags: [],
    is_archived: false,
    is_draft: false,
    is_favorite: false,
    is_safe: true,
    can_edit: true,
    user: { id: 1, name: 'Admin User', email: 'admin@example.com' },
    last_modified_by: { id: 1, name: 'Admin User', email: 'admin@example.com' },
    visualizations: [],
    latest_query_data_id: DATA_ID,
    options: { parameters: [] },
    created_at: '',
    updated_at: '',
    retrieved_at: '',
    runtime: 0,
  }
}

function seedQuery(data: MockQueryResult['data']) {
  const query = baseMockQuery()
  const queryResult: MockQueryResult = {
    id: DATA_ID,
    query_hash: 'hash',
    query: query.query,
    data_source_id: 1,
    runtime: 0,
    retrieved_at: '2026-01-01T00:00:00Z',
    data,
  }
  useMockDataStore.setState((s) => ({
    queries: [...s.queries, query],
    queryResults: { ...s.queryResults, [DATA_ID]: queryResult },
  }))
}

function seedStringCategoryChartQuery() {
  seedQuery({
    // A plain string category axis (year labels), not a date/datetime
    // column: date-parseable ("2025", "2026" both parse as valid dates via
    // Date.parse) but not actually a time series.
    columns: [
      { name: 'year', friendly_name: 'Year', type: 'string' },
      { name: 'boardings', friendly_name: 'Boardings', type: 'integer' },
    ],
    rows: [
      { year: '2025', boardings: 100 },
      { year: '2026', boardings: 200 },
    ],
  })
}

function seedDatetimeChartQuery() {
  seedQuery({
    columns: [
      { name: 'day', friendly_name: 'Day', type: 'date' },
      { name: 'boardings', friendly_name: 'Boardings', type: 'integer' },
    ],
    rows: [
      { day: '2026-01-01', boardings: 100 },
      { day: '2026-01-02', boardings: 200 },
    ],
  })
}

type MockWidgetVisualization = NonNullable<MockDashboardWidget['visualization']>

function widgetFor(overrides: Partial<MockWidgetVisualization> = {}): MockDashboardWidget {
  return {
    id: 501,
    dashboard_id: 1,
    width: 1,
    options: { position: { col: 0, row: 0, sizeX: 1, sizeY: 1 } },
    visualization: {
      id: 5010,
      type: 'CHART',
      name: 'Ridership by year',
      description: '',
      options: {},
      query: { id: QUERY_ID, name: 'Ridership by year', latest_query_data_id: DATA_ID },
      ...overrides,
    },
  }
}

describe('VisualizationWidget annotation gating', () => {
  it('does not place annotations on a CHART widget with a non-datetime (string category) x-axis', async () => {
    seedStringCategoryChartQuery()
    const annotations: Annotation[] = [
      {
        id: 1,
        dashboard_id: 1,
        widget_id: null,
        start: '2025-06-01T00:00:00Z',
        end: null,
        label: 'Should not appear',
        source: 'manual',
        created_at: '2025-01-01T00:00:00Z',
      },
    ]

    const { container } = renderWithProviders(
      <ConfigProvider value={CONFIG}>
        <VisualizationWidget widget={widgetFor()} isEditing={false} annotations={annotations} />
      </ConfigProvider>
    )

    // A plain `svg` selector is vacuous here: the widget's header renders
    // lucide icon buttons (refresh, expand, annotate, open) synchronously on
    // first render, each its own <svg>, well before the query resolves. Scope
    // to recharts' own surface element instead, which only exists once the
    // chart itself has mounted. Assert it is absent synchronously, right
    // after render and before the query settles, so a future regression back
    // to a chrome-satisfied selector shows up here rather than silently
    // passing for the wrong reason.
    expect(container.querySelector('.recharts-surface')).not.toBeInTheDocument()

    // Wait for the chart itself to mount (the query result loads async
    // through TanStack Query even in mock mode) before asserting the
    // annotation's absence, so this fails for the right reason: the gating,
    // not an unloaded chart. recharts' x-axis ticks are unreliable under
    // jsdom (it culls ticks it thinks would overlap, since jsdom always
    // reports zero text width), so the surface element is the signal instead.
    await waitFor(() => expect(container.querySelector('.recharts-surface')).toBeInTheDocument())
    expect(screen.queryByText('Should not appear')).not.toBeInTheDocument()
  })

  it('places annotations on a CHART widget with a real datetime x-axis (positive control)', async () => {
    seedDatetimeChartQuery()
    const annotations: Annotation[] = [
      {
        id: 2,
        dashboard_id: 1,
        widget_id: null,
        start: '2026-01-01T12:00:00Z',
        end: null,
        label: 'Launch day',
        source: 'manual',
        created_at: '2026-01-01T00:00:00Z',
      },
    ]

    renderWithProviders(
      <ConfigProvider value={CONFIG}>
        <VisualizationWidget widget={widgetFor()} isEditing={false} annotations={annotations} />
      </ConfigProvider>
    )

    expect(await screen.findByText('Launch day')).toBeInTheDocument()
  })
})
