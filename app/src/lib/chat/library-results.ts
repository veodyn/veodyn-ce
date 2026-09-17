import type { MockDashboard, MockQuery, MockVisualization, QueryResultData } from '@/lib/mock-data'
import { summarizeRows } from './shape-result'
import type {
  ChatDashboardResult,
  ChatDashboardWidget,
  ChatLibraryItem,
  ChatLibraryResult,
  ChatSavedVisualizationResult,
  ChatVisualizationRef,
} from './tool-results'

export const LIBRARY_LIMIT = 10
export const DESCRIPTION_CHARS = 300
export const TAG_LIMIT = 10
export const SQL_CHARS = 8_000
export const VISUALIZATION_LIMIT = 20
export const WIDGET_LIMIT = 50
export const PARAMETER_LIMIT = 50
const NAME_CHARS = 500
const TYPE_CHARS = 64

export const NO_STORED_RESULT = 'This query has no stored result; the analyst can run it from the card.'
export const NOT_AVAILABLE = 'Not found, or not shared with the analyst.'

export interface Page<T> {
  results: T[]
  count: number
}

function clip(value: string | null | undefined, limit: number): string {
  return (value ?? '').slice(0, limit)
}

function optional(value: string | null | undefined, limit: number): string | undefined {
  const clipped = clip(value, limit).trim()
  return clipped ? clipped : undefined
}

function tagsOf(tags: string[] | undefined): string[] {
  return (tags ?? []).slice(0, TAG_LIMIT).map((tag) => clip(tag, TYPE_CHARS))
}

function queryItem(query: MockQuery): ChatLibraryItem {
  return {
    type: 'query',
    id: query.id,
    name: clip(query.name, NAME_CHARS),
    description: optional(query.description, DESCRIPTION_CHARS),
    tags: tagsOf(query.tags),
    updatedAt: optional(query.updated_at, TYPE_CHARS),
    hasResult: query.latest_query_data_id != null,
  }
}

function dashboardItem(dashboard: MockDashboard): ChatLibraryItem {
  return {
    type: 'dashboard',
    id: dashboard.id,
    name: clip(dashboard.name, NAME_CHARS),
    tags: tagsOf(dashboard.tags),
    updatedAt: optional(dashboard.updated_at, TYPE_CHARS),
  }
}

function take<T extends { is_archived: boolean }>(page: Page<T> | null): { kept: T[]; more: boolean } {
  if (!page) return { kept: [], more: false }
  const live = page.results.filter((item) => !item.is_archived)
  return { kept: live.slice(0, LIBRARY_LIMIT), more: live.length > LIBRARY_LIMIT || page.count > page.results.length }
}

export function libraryResult(queries: Page<MockQuery> | null, dashboards: Page<MockDashboard> | null): ChatLibraryResult {
  const foundQueries = take(queries)
  const foundDashboards = take(dashboards)
  return {
    kind: 'library',
    ok: true,
    items: [...foundQueries.kept.map(queryItem), ...foundDashboards.kept.map(dashboardItem)],
    more: foundQueries.more || foundDashboards.more,
  }
}

function visualizationRef(visualization: { id: number; name: string; type: string }): ChatVisualizationRef {
  return {
    id: visualization.id,
    name: clip(visualization.name || visualization.type, NAME_CHARS),
    type: clip(visualization.type, TYPE_CHARS),
  }
}

export function pickVisualization(query: MockQuery, wanted: number | null): MockVisualization | string {
  const visualizations = query.visualizations ?? []
  if (wanted !== null) {
    const found = visualizations.find((one) => one.id === wanted)
    if (found) return found
    const ids = visualizations.map((one) => one.id).join(', ') || 'none'
    return `The query has no visualization ${wanted}. Its visualizations are: ${ids}.`
  }
  const chosen = visualizations.find((one) => one.type !== 'TABLE') ?? visualizations[0]
  return chosen ?? 'The query has no visualizations.'
}

export function hasParameters(query: MockQuery): boolean {
  return (query.options?.parameters ?? []).length > 0
}

export function savedVisualizationResult(
  query: MockQuery,
  visualization: MockVisualization,
  data: QueryResultData,
  retrievedAt: string | null | undefined
): ChatSavedVisualizationResult {
  return {
    kind: 'saved_visualization',
    ok: true,
    ...summarizeRows(data),
    query: {
      id: query.id,
      name: clip(query.name, NAME_CHARS),
      description: optional(query.description, 4_000),
      sql: clip(query.query, SQL_CHARS),
      dataSourceId: query.data_source_id > 0 ? query.data_source_id : undefined,
      parameters: (query.options?.parameters ?? []).slice(0, PARAMETER_LIMIT).map((one) => clip(one.name, 255)),
      updatedAt: optional(query.updated_at, TYPE_CHARS),
    },
    visualization: visualizationRef(visualization),
    visualizations: (query.visualizations ?? []).slice(0, VISUALIZATION_LIMIT).map(visualizationRef),
    retrievedAt: optional(retrievedAt, TYPE_CHARS),
  }
}

function widgetTitle(queryName: string | undefined, visualizationName: string): string {
  if (!queryName) return visualizationName
  if (!visualizationName || visualizationName === 'Table') return queryName
  return `${queryName} · ${visualizationName}`
}

export function dashboardResult(dashboard: MockDashboard): ChatDashboardResult {
  const shown = dashboard.widgets
    .filter((widget) => !widget.options?.isHidden)
    .sort((a, b) => {
      const one = a.options?.position ?? { row: 0, col: 0 }
      const two = b.options?.position ?? { row: 0, col: 0 }
      return one.row - two.row || one.col - two.col
    })
  const widgets: ChatDashboardWidget[] = []
  for (const widget of shown) {
    const visualization = widget.visualization
    if (!visualization) continue
    const queryName = optional(visualization.query.name, NAME_CHARS)
    widgets.push({
      title: clip(widgetTitle(queryName, visualization.name), NAME_CHARS),
      queryId: visualization.query.id,
      queryName,
      visualizationId: visualization.id,
      visualizationType: clip(visualization.type, TYPE_CHARS),
    })
  }
  return {
    kind: 'dashboard',
    ok: true,
    dashboard: {
      id: dashboard.id,
      name: clip(dashboard.name, NAME_CHARS),
      tags: tagsOf(dashboard.tags),
      updatedAt: optional(dashboard.updated_at, TYPE_CHARS),
    },
    widgets: widgets.slice(0, WIDGET_LIMIT),
    textWidgets: shown.filter((widget) => !widget.visualization).length,
  }
}
