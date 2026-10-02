import type { RedashDataSource } from '@/services/redash/data-sources'
import type { SchemaTable } from '@/lib/mock-data'
import type { MockDashboard, MockQuery, MockVisualization, QueryResultData } from '@/lib/mock-data'
import { summarizeRows } from './shape-result'
import type {
  ChatDashboardResult,
  ChatDashboardWidget,
  ChatDataSourceRef,
  ChatDataSourceResource,
  ChatDataSourceSchemaResult,
  ChatDataSourcesResult,
  ChatDataSourceTable,
  ChatLibraryItem,
  ChatLibraryResult,
  ChatSavedVisualizationResult,
  ChatVisualizationRef,
} from './tool-results'
import { ERROR_CHARS } from './tool-results'

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

function visibleWidgets(dashboard: MockDashboard) {
  return dashboard.widgets
    .filter((widget) => !widget.options?.isHidden)
    .sort((a, b) => {
      const one = a.options?.position ?? { row: 0, col: 0 }
      const two = b.options?.position ?? { row: 0, col: 0 }
      return one.row - two.row || one.col - two.col
    })
}

/** The chart/table widget count a dashboard draft's drift check (spec 3b
 * section 6.3) compares against: hidden and text widgets excluded, and — the
 * whole reason this is its own function rather than `widgets.length` on a
 * shaped result — never capped at WIDGET_LIMIT the way that array is. */
export function visibleWidgetCount(dashboard: MockDashboard): number {
  return visibleWidgets(dashboard).filter((widget) => widget.visualization).length
}

export function dashboardResult(dashboard: MockDashboard): ChatDashboardResult {
  const shown = visibleWidgets(dashboard)
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
    widgetCount: widgets.length,
    textWidgets: shown.filter((widget) => !widget.visualization).length,
  }
}

export const DATA_SOURCE_LIMIT = 50
export const TABLE_LIMIT = 200
export const COLUMN_NAME_LIMIT = 100
export const RESOURCE_LIMIT = 50
const DATA_SOURCE_TYPE_CHARS = 64
const DATA_SOURCE_SYNTAX_CHARS = 32
const RESOURCE_NAME_CHARS = 128
const EXAMPLE_CHARS = 500

/** Chat can query "sql" and "json" syntax sources; every other syntax
 * (custom, yaml, ...) is listed so the model can say it exists, but
 * describe_data_source and run_query both refuse it (spec 3a section 2). */
export const UNSUPPORTED_SYNTAX = 'chat cannot query this data source yet'
export const NO_RESULTS_SCHEMA =
  'this data source has no static schema; it exposes other saved queries as query_<id> tables — call ' +
  'show_visualization on the specific query to learn its columns'

export function dataSourcesResult(sources: RedashDataSource[]): ChatDataSourcesResult {
  const refs: ChatDataSourceRef[] = sources.slice(0, DATA_SOURCE_LIMIT).map((source) => ({
    id: source.id,
    name: clip(source.name, NAME_CHARS),
    type: clip(source.type, DATA_SOURCE_TYPE_CHARS),
    syntax: clip(source.syntax ?? 'sql', DATA_SOURCE_SYNTAX_CHARS),
    viewOnly: source.view_only ?? false,
  }))
  return { kind: 'data_sources', ok: true, sources: refs }
}

export function failedDataSourceSchemaResult(dataSourceId: number, error: string): ChatDataSourceSchemaResult {
  return { kind: 'data_source_schema', ok: false, dataSourceId, error: clip(error, ERROR_CHARS) }
}

function sqlSchemaResult(dataSourceId: number, tables: SchemaTable[]): ChatDataSourceSchemaResult {
  const shaped: ChatDataSourceTable[] = tables.slice(0, TABLE_LIMIT).map((table) => ({
    name: clip(table.name, NAME_CHARS),
    columns: table.columns.slice(0, COLUMN_NAME_LIMIT).map((column) => clip(column.name, NAME_CHARS)),
  }))
  return { kind: 'data_source_schema', ok: true, dataSourceId, syntax: 'sql', tables: shaped }
}

// BaseResourceRunner.get_schema() (node/redash/query_runner/connector_base.py)
// returns one "<n>. <name> > params" table per resource, an optional sibling
// "<n>. <name> > returns", and a trailing "__ Query Examples __" table whose
// columns are each resource's example string, in the same order. Every
// doc_params entry is free-text documentation ("stop_id (optional): string -
// predictions for one stop"), not a bare param name, so the actual param name
// is the identifier before the first "(".
const RESOURCE_SECTION_RE = /^(\d+)\.\s+(.+?)\s+>\s+(params|returns)$/
const PARAM_NAME_RE = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(/
const EXAMPLES_TABLE_NAME = '__ Query Examples __'

function resourceName(paramDoc: string): string | null {
  return PARAM_NAME_RE.exec(paramDoc)?.[1] ?? null
}

function resourceSchemaResult(dataSourceId: number, tables: SchemaTable[]): ChatDataSourceSchemaResult {
  const byIndex = new Map<number, { name: string; params: string[]; returns: string[] }>()
  let examples: string[] = []
  for (const table of tables) {
    if (table.name === EXAMPLES_TABLE_NAME) {
      examples = table.columns.map((column) => column.name)
      continue
    }
    const match = RESOURCE_SECTION_RE.exec(table.name)
    if (!match) continue
    const index = Number(match[1])
    const entry = byIndex.get(index) ?? { name: match[2], params: [], returns: [] }
    if (match[3] === 'params') {
      entry.params = table.columns.map((column) => resourceName(column.name)).filter((one): one is string => one !== null)
    } else {
      entry.returns = table.columns.map((column) => clip(column.name, NAME_CHARS))
    }
    byIndex.set(index, entry)
  }
  const resources: ChatDataSourceResource[] = [...byIndex.entries()]
    .sort(([a], [b]) => a - b)
    .slice(0, RESOURCE_LIMIT)
    .map(([index, entry]) => ({
      name: clip(entry.name, RESOURCE_NAME_CHARS),
      params: entry.params.slice(0, RESOURCE_LIMIT).map((one) => clip(one, RESOURCE_NAME_CHARS)),
      returns: entry.returns,
      example: optional(examples[index - 1], EXAMPLE_CHARS),
    }))
  return { kind: 'data_source_schema', ok: true, dataSourceId, syntax: 'json', resources }
}

export function dataSourceSchemaResult(
  dataSourceId: number,
  syntax: string,
  tables: SchemaTable[]
): ChatDataSourceSchemaResult {
  if (syntax === 'sql') return sqlSchemaResult(dataSourceId, tables)
  if (syntax === 'json') return resourceSchemaResult(dataSourceId, tables)
  return failedDataSourceSchemaResult(dataSourceId, UNSUPPORTED_SYNTAX)
}
