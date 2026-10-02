import { readQueryError } from '@/lib/query-error'
import { ApiError } from '@/services/api-client'
import * as dashboardsService from '@/services/redash/dashboards'
import * as dataSourcesService from '@/services/redash/data-sources'
import { getResult } from '@/services/redash/execution'
import * as queriesService from '@/services/redash/queries'
import type { ChatToolRequestOf } from './frames'
import {
  dashboardResult,
  dataSourcesResult,
  dataSourceSchemaResult,
  failedDataSourceSchemaResult,
  libraryResult,
  NO_RESULTS_SCHEMA,
  NO_STORED_RESULT,
  NOT_AVAILABLE,
  pickVisualization,
  savedVisualizationResult,
  UNSUPPORTED_SYNTAX,
} from './library-results'
import { failedResult, type ChatResultKind, type ChatToolResult } from './tool-results'

export type LibraryToolRequest = ChatToolRequestOf<
  'list_data_sources' | 'describe_data_source' | 'search_library' | 'show_visualization' | 'open_dashboard'
>

// A literal per-key type (not Record<K, V>, which would erase the
// correlation between a tool and its own result kind) so that narrowing
// LibraryToolRequest['tool'] at a call site — excluding 'describe_data_source'
// before the fallback in runLibraryTool below — also narrows the value this
// indexes to, away from 'data_source_schema'.
export const LIBRARY_RESULT_KIND = {
  list_data_sources: 'data_sources',
  describe_data_source: 'data_source_schema',
  search_library: 'library',
  show_visualization: 'saved_visualization',
  open_dashboard: 'dashboard',
} as const satisfies Record<LibraryToolRequest['tool'], ChatResultKind>

// A "results" (query_results) data source's get_schema() has nothing to
// return — node itself raises NotSupported (spec 3a section 4.2) — so its
// type is checked and short-circuited before any schema round trip, rather
// than interpreting node's schema-job error envelope.
const RESULTS_SOURCE_TYPE = 'results'

function refusal(error: unknown): string {
  if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return NOT_AVAILABLE
  return readQueryError(error).message
}

async function listDataSources(signal: AbortSignal): Promise<ChatToolResult> {
  return dataSourcesResult(await dataSourcesService.listDataSources(signal))
}

async function describeDataSource(
  request: ChatToolRequestOf<'describe_data_source'>,
  signal: AbortSignal
): Promise<ChatToolResult> {
  const { dataSourceId } = request.args
  const source = await dataSourcesService.getDataSource(dataSourceId, signal)
  if (!source) return failedDataSourceSchemaResult(dataSourceId, NOT_AVAILABLE)
  if (source.type === RESULTS_SOURCE_TYPE) return failedDataSourceSchemaResult(dataSourceId, NO_RESULTS_SCHEMA)
  const syntax = source.syntax ?? 'sql'
  if (syntax !== 'sql' && syntax !== 'json') return failedDataSourceSchemaResult(dataSourceId, UNSUPPORTED_SYNTAX)
  const tables = await dataSourcesService.getSchema(dataSourceId, false, signal)
  return dataSourceSchemaResult(dataSourceId, syntax, tables)
}

async function searchLibrary(
  request: ChatToolRequestOf<'search_library'>,
  signal: AbortSignal
): Promise<ChatToolResult> {
  const { text, kinds, tags } = request.args
  const options = { signal, tags: tags.length > 0 ? tags : undefined }
  const [queries, dashboards] = await Promise.all([
    kinds.includes('query') ? queriesService.search(text, options) : null,
    kinds.includes('dashboard') ? dashboardsService.search(text, options) : null,
  ])
  return libraryResult(queries, dashboards)
}

async function showVisualization(
  request: ChatToolRequestOf<'show_visualization'>,
  signal: AbortSignal
): Promise<ChatToolResult> {
  const query = await queriesService.get(request.args.queryId)
  if (!query || query.is_archived) return failedResult('saved_visualization', NOT_AVAILABLE)
  const visualization = pickVisualization(query, request.args.visualizationId)
  if (typeof visualization === 'string') return failedResult('saved_visualization', visualization)
  if (query.latest_query_data_id == null) return failedResult('saved_visualization', NO_STORED_RESULT)
  const stored = await getResult(query.latest_query_data_id, signal)
  return savedVisualizationResult(query, visualization, stored.data, stored.retrieved_at)
}

async function openDashboard(request: ChatToolRequestOf<'open_dashboard'>): Promise<ChatToolResult> {
  const dashboard = await dashboardsService.get(request.args.dashboardId)
  if (!dashboard || dashboard.is_archived) return failedResult('dashboard', NOT_AVAILABLE)
  return dashboardResult(dashboard)
}

function dispatch(request: LibraryToolRequest, signal: AbortSignal): Promise<ChatToolResult> {
  switch (request.tool) {
    case 'list_data_sources':
      return listDataSources(signal)
    case 'describe_data_source':
      return describeDataSource(request, signal)
    case 'search_library':
      return searchLibrary(request, signal)
    case 'show_visualization':
      return showVisualization(request, signal)
    case 'open_dashboard':
      return openDashboard(request)
  }
}

export async function runLibraryTool(request: LibraryToolRequest, signal: AbortSignal): Promise<ChatToolResult> {
  try {
    return await dispatch(request, signal)
  } catch (error) {
    if (signal.aborted) throw error
    // data_source_schema is the one result kind that always carries an id
    // (spec 3a section 4.2), so a mid-flight failure needs it too, unlike
    // every other kind's minimal {kind, ok: false, error}.
    if (request.tool === 'describe_data_source') {
      return failedDataSourceSchemaResult(request.args.dataSourceId, refusal(error))
    }
    return failedResult(LIBRARY_RESULT_KIND[request.tool], refusal(error))
  }
}
