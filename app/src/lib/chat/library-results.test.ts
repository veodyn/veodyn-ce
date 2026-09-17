import { describe, expect, it } from 'vitest'
import type { MockDashboard, MockDashboardWidget, MockQuery, MockVisualization } from '@/lib/mock-data'
import {
  dashboardResult,
  DESCRIPTION_CHARS,
  hasParameters,
  libraryResult,
  LIBRARY_LIMIT,
  pickVisualization,
  savedVisualizationResult,
  SQL_CHARS,
} from './library-results'

function viz(id: number, type: string, name = `${type} ${id}`): MockVisualization {
  return { id, type, name, description: '', options: {}, created_at: '', updated_at: '' }
}

function query(overrides: Partial<MockQuery> = {}): MockQuery {
  return {
    id: 12,
    name: 'Trips by hour',
    description: '',
    query: 'SELECT 1',
    data_source_id: 3,
    schedule: null,
    tags: ['bikeshare'],
    is_archived: false,
    is_draft: false,
    is_favorite: false,
    is_safe: true,
    can_edit: true,
    user: { id: 1, name: 'a', email: 'a@x' },
    last_modified_by: { id: 1, name: 'a', email: 'a@x' },
    visualizations: [viz(30, 'TABLE', 'Table'), viz(31, 'CHART', 'Trips')],
    latest_query_data_id: 99,
    options: { parameters: [] },
    created_at: '',
    updated_at: '2026-09-01T10:00:00Z',
    retrieved_at: '',
    runtime: 0,
    ...overrides,
  }
}

function widget(id: number, overrides: Partial<MockDashboardWidget> = {}): MockDashboardWidget {
  return {
    id,
    dashboard_id: 4,
    width: 1,
    options: { position: { col: 0, row: 0, sizeX: 3, sizeY: 8 } },
    ...overrides,
  }
}

function chartWidget(id: number, row: number, col: number, queryName = 'Trips by hour'): MockDashboardWidget {
  return widget(id, {
    options: { position: { col, row, sizeX: 3, sizeY: 8 } },
    visualization: { id: id * 10, type: 'CHART', name: `Chart ${id}`, description: '', options: {}, query: { id, name: queryName } },
  })
}

function dashboard(widgets: MockDashboardWidget[]): MockDashboard {
  return {
    id: 4,
    name: 'Bikeshare overview',
    slug: 'bikeshare',
    tags: ['bikeshare'],
    is_archived: false,
    is_draft: false,
    is_favorite: false,
    can_edit: true,
    user: { id: 1, name: 'a', email: 'a@x' },
    widgets,
    dashboard_filters_enabled: false,
    created_at: '',
    updated_at: '2026-08-30T08:00:00Z',
    public_url: null,
    api_key: null,
  }
}

describe('libraryResult', () => {
  it('lists live queries before dashboards, with what the model needs', () => {
    const result = libraryResult(
      { results: [query({ description: 'd'.repeat(400) }), query({ id: 13, is_archived: true })], count: 2 },
      { results: [dashboard([])], count: 1 }
    )
    expect(result.items).toEqual([
      {
        type: 'query',
        id: 12,
        name: 'Trips by hour',
        description: 'd'.repeat(DESCRIPTION_CHARS),
        tags: ['bikeshare'],
        updatedAt: '2026-09-01T10:00:00Z',
        hasResult: true,
      },
      { type: 'dashboard', id: 4, name: 'Bikeshare overview', tags: ['bikeshare'], updatedAt: '2026-08-30T08:00:00Z' },
    ])
    expect(result.more).toBe(false)
  })

  it('caps each kind and says when there is more', () => {
    const many = Array.from({ length: LIBRARY_LIMIT + 2 }, (_, index) => query({ id: index + 1 }))
    const result = libraryResult({ results: many, count: many.length }, null)
    expect(result.items).toHaveLength(LIBRARY_LIMIT)
    expect(result.more).toBe(true)
    expect(libraryResult({ results: [query()], count: 40 }, null).more).toBe(true)
  })

  it('marks a query that never ran and skips an empty description', () => {
    const result = libraryResult(
      { results: [query({ latest_query_data_id: null, description: '  ' })], count: 1 },
      null
    )
    const [item] = result.items ?? []
    expect(item.hasResult).toBe(false)
    expect(item).not.toHaveProperty('description', expect.anything())
  })
})

describe('pickVisualization', () => {
  it('prefers the asked-for id, then the first chart, then the table', () => {
    expect(pickVisualization(query(), 30)).toMatchObject({ id: 30 })
    expect(pickVisualization(query(), null)).toMatchObject({ id: 31 })
    expect(pickVisualization(query({ visualizations: [viz(30, 'TABLE')] }), null)).toMatchObject({ id: 30 })
  })

  it('explains a missing id or a query with nothing to draw', () => {
    expect(pickVisualization(query(), 77)).toBe('The query has no visualization 77. Its visualizations are: 30, 31.')
    expect(pickVisualization(query({ visualizations: [] }), null)).toBe('The query has no visualizations.')
  })
})

describe('savedVisualizationResult', () => {
  it('summarizes the stored rows and describes the query', () => {
    const data = { columns: [{ name: 'n', type: 'integer', friendly_name: 'n' }], rows: [{ n: 1 }, { n: 2 }] }
    const parameters = [{ name: 'start', title: 'Start', type: 'date', value: null }]
    const source = query({ query: 'x'.repeat(SQL_CHARS + 5), options: { parameters } })
    const result = savedVisualizationResult(source, viz(31, 'CHART', 'Trips'), data, '2026-09-17T06:00:00Z')
    expect(result).toMatchObject({
      kind: 'saved_visualization',
      ok: true,
      rowCount: 2,
      truncated: false,
      sample: [{ n: 1 }, { n: 2 }],
      visualization: { id: 31, name: 'Trips', type: 'CHART' },
      visualizations: [
        { id: 30, name: 'Table', type: 'TABLE' },
        { id: 31, name: 'Trips', type: 'CHART' },
      ],
      retrievedAt: '2026-09-17T06:00:00Z',
      query: { id: 12, name: 'Trips by hour', dataSourceId: 3, parameters: ['start'] },
    })
    expect(result.query?.sql).toHaveLength(SQL_CHARS)
    expect(hasParameters(source)).toBe(true)
    expect(hasParameters(query())).toBe(false)
  })
})

describe('dashboardResult', () => {
  it('lists visible charts in layout order and counts text widgets', () => {
    const result = dashboardResult(
      dashboard([
        chartWidget(2, 1, 0, ''),
        chartWidget(1, 0, 3),
        widget(3, { text: '## Notes' }),
        { ...chartWidget(4, 0, 0), options: { position: { col: 0, row: 0, sizeX: 1, sizeY: 1 }, isHidden: true } },
        chartWidget(5, 0, 0),
      ])
    )
    expect(result.widgets).toEqual([
      { title: 'Trips by hour · Chart 5', queryId: 5, queryName: 'Trips by hour', visualizationId: 50, visualizationType: 'CHART' },
      { title: 'Trips by hour · Chart 1', queryId: 1, queryName: 'Trips by hour', visualizationId: 10, visualizationType: 'CHART' },
      { title: 'Chart 2', queryId: 2, visualizationId: 20, visualizationType: 'CHART' },
    ])
    expect(result.textWidgets).toBe(1)
    expect(result.dashboard).toEqual({
      id: 4,
      name: 'Bikeshare overview',
      tags: ['bikeshare'],
      updatedAt: '2026-08-30T08:00:00Z',
    })
  })
})
