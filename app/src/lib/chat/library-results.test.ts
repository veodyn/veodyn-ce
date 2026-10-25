import { describe, expect, it } from 'vitest'
import type { MockDashboard, MockDashboardWidget, MockQuery, MockVisualization } from '@/lib/mock-data'
import {
  DASHBOARD_LIMIT,
  dashboardResult,
  DESCRIPTION_CHARS,
  hasParameters,
  libraryResult,
  LIBRARY_LIMIT,
  pickVisualization,
  savedVisualizationResult,
  SQL_CHARS,
  visibleWidgetCount,
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
        archived: false,
      },
      {
        type: 'dashboard',
        id: 4,
        name: 'Bikeshare overview',
        tags: ['bikeshare'],
        updatedAt: '2026-08-30T08:00:00Z',
        archived: false,
      },
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

  it('lists a full page of dashboards and gives how many matched of each kind', () => {
    const boards = Array.from({ length: DASHBOARD_LIMIT + 5 }, (_, index) => ({ ...dashboard([]), id: index + 1 }))
    const result = libraryResult({ results: [query()], count: 204 }, { results: boards, count: 55 })
    expect(result.items?.filter((item) => item.type === 'dashboard')).toHaveLength(DASHBOARD_LIMIT)
    expect(result).toMatchObject({ queryCount: 204, dashboardCount: 55, more: true })
  })

  it('carries the tag groups of a browse, largest first, and leaves them out otherwise', () => {
    const groups = {
      dashboard: [
        { name: 'transit-demo', count: 4 },
        { name: 'traveler-site', count: 17 },
      ],
    }
    const browsed = libraryResult(null, { results: [dashboard([])], count: 1 }, groups)
    expect(browsed.tagCounts).toEqual([
      { kind: 'dashboard', name: 'traveler-site', count: 17 },
      { kind: 'dashboard', name: 'transit-demo', count: 4 },
    ])
    expect(libraryResult(null, { results: [], count: 0 }).tagCounts).toBeUndefined()
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

describe('canEdit on single-object reads', () => {
  it('saved_visualization result carries canEdit', () => {
    const data = { columns: [], rows: [] }
    const editable = savedVisualizationResult(query(), viz(31, 'CHART'), data, null)
    const readOnly = savedVisualizationResult(query({ can_edit: false }), viz(31, 'CHART'), data, null)
    expect(editable.query?.canEdit).toBe(true)
    expect(readOnly.query?.canEdit).toBe(false)
  })

  it('dashboard result carries canEdit', () => {
    expect(dashboardResult(dashboard([])).dashboard?.canEdit).toBe(true)
    expect(dashboardResult({ ...dashboard([]), can_edit: false }).dashboard?.canEdit).toBe(false)
  })
})

describe('dashboardResult', () => {
  it('lists visible widgets in layout order with their ids, positions and kinds', () => {
    const result = dashboardResult(
      dashboard([
        chartWidget(2, 1, 0, ''),
        chartWidget(1, 0, 3),
        widget(3, { text: '## Notes\nmore', updated_at: 'T3', options: { position: { col: 0, row: 1, sizeX: 6, sizeY: 4 } } }),
        { ...chartWidget(4, 0, 0), options: { position: { col: 0, row: 0, sizeX: 1, sizeY: 1 }, isHidden: true } },
        chartWidget(5, 0, 0),
      ])
    )
    expect(result.widgets).toEqual([
      {
        widgetId: 5,
        kind: 'visualization',
        title: 'Trips by hour · Chart 5',
        queryId: 5,
        queryName: 'Trips by hour',
        visualizationId: 50,
        visualizationType: 'CHART',
        position: { col: 0, row: 0, sizeX: 3, sizeY: 8 },
      },
      {
        widgetId: 1,
        kind: 'visualization',
        title: 'Trips by hour · Chart 1',
        queryId: 1,
        queryName: 'Trips by hour',
        visualizationId: 10,
        visualizationType: 'CHART',
        position: { col: 3, row: 0, sizeX: 3, sizeY: 8 },
      },
      {
        widgetId: 2,
        kind: 'visualization',
        title: 'Chart 2',
        queryId: 2,
        visualizationId: 20,
        visualizationType: 'CHART',
        position: { col: 0, row: 1, sizeX: 3, sizeY: 8 },
      },
      {
        widgetId: 3,
        kind: 'text',
        title: '## Notes',
        text: '## Notes\nmore',
        position: { col: 0, row: 1, sizeX: 6, sizeY: 4 },
        updatedAt: 'T3',
      },
    ])
    expect(result.dashboard).toEqual({
      id: 4,
      name: 'Bikeshare overview',
      tags: ['bikeshare'],
      updatedAt: '2026-08-30T08:00:00Z',
      canEdit: true,
    })
  })

  it('counts only charts in widgetCount, and text boxes apart', () => {
    const result = dashboardResult(dashboard([chartWidget(1, 0, 0), widget(2, { text: 'a' }), widget(3, { text: 'b' })]))
    expect(result.widgetCount).toBe(1)
    expect(result.textWidgets).toBe(2)
    expect(result.widgets).toHaveLength(3)
    expect(visibleWidgetCount(dashboard([chartWidget(1, 0, 0), widget(2, { text: 'a' })]))).toBe(1)
  })

  it('carries the dashboard version, widget timestamps and parameter mappings', () => {
    const mapped = chartWidget(1, 0, 0)
    mapped.updated_at = '2026-10-01T00:00:00.123Z'
    mapped.options = {
      ...mapped.options,
      parameterMappings: {
        start: { type: 'dashboard-add-new', mapTo: 'start', value: null, title: 'Start' },
        junk: { type: 'bogus' },
        city: { type: 'static-value', value: 'LA' },
      },
    }
    const result = dashboardResult({ ...dashboard([mapped]), version: 7 })
    expect(result.dashboard?.version).toBe(7)
    expect(result.widgets?.[0]).toMatchObject({
      updatedAt: '2026-10-01T00:00:00.123Z',
      parameterMappings: {
        start: { type: 'dashboard-add-new', mapTo: 'start', value: null, title: 'Start' },
        city: { type: 'static-value', value: 'LA' },
      },
    })
    expect(result.widgets?.[0].parameterMappings).not.toHaveProperty('junk')
  })

  it('caps the listed widgets at 50 while still counting every chart', () => {
    const many = Array.from({ length: 53 }, (_, index) => chartWidget(index + 1, index, 0))
    const result = dashboardResult(dashboard(many))
    expect(result.widgets).toHaveLength(50)
    expect(result.widgetCount).toBe(53)
  })
})
