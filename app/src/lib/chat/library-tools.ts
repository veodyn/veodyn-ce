import { readQueryError } from '@/lib/query-error'
import type { TagSuggestion } from '@/lib/tags'
import { ApiError } from '@/services/api-client'
import type { ChatToolRequestOf } from './frames'
import type { LibraryTagGroups } from './library-tag-counts'
import {
  DASHBOARD_LIMIT,
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
import * as nodeCalls from './node-calls'
import { runOpenQuery } from './query-detail'
import type { RedashTransport } from './transport'
import { failedResult, type ChatLibraryItem, type ChatResultKind, type ChatToolResult } from './tool-results'

export type LibraryToolRequest = ChatToolRequestOf<
  | 'list_data_sources'
  | 'describe_data_source'
  | 'search_library'
  | 'show_visualization'
  | 'open_dashboard'
  | 'open_query'
>

export const LIBRARY_RESULT_KIND = {
  list_data_sources: 'data_sources',
  describe_data_source: 'data_source_schema',
  search_library: 'library',
  show_visualization: 'saved_visualization',
  open_dashboard: 'dashboard',
  open_query: 'query_detail',
} as const satisfies Record<LibraryToolRequest['tool'], ChatResultKind>

const RESULTS_SOURCE_TYPE = 'results'
const RECENTLY_EDITED_FIRST = '-updated_at'

function refusal(error: unknown): string {
  if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return NOT_AVAILABLE
  return readQueryError(error).message
}

async function listDataSources(transport: RedashTransport, signal: AbortSignal): Promise<ChatToolResult> {
  return dataSourcesResult(await nodeCalls.listDataSources(transport, signal))
}

async function describeDataSource(
  request: ChatToolRequestOf<'describe_data_source'>,
  transport: RedashTransport,
  signal: AbortSignal
): Promise<ChatToolResult> {
  const { dataSourceId } = request.args
  const source = await nodeCalls.getDataSource(transport, dataSourceId, signal)
  if (!source) return failedDataSourceSchemaResult(dataSourceId, NOT_AVAILABLE)
  if (source.type === RESULTS_SOURCE_TYPE) return failedDataSourceSchemaResult(dataSourceId, NO_RESULTS_SCHEMA)
  const syntax = source.syntax ?? 'sql'
  if (syntax !== 'sql' && syntax !== 'json') return failedDataSourceSchemaResult(dataSourceId, UNSUPPORTED_SYNTAX)
  const tables = await nodeCalls.getSchema(transport, dataSourceId, false, signal)
  return dataSourceSchemaResult(dataSourceId, syntax, tables)
}

function tagGroup(
  transport: RedashTransport,
  scope: nodeCalls.NodeTagScope,
  signal: AbortSignal
): Promise<TagSuggestion[] | undefined> {
  return nodeCalls.tagVocabulary(transport, scope, signal).catch((error: unknown) => {
    if (signal.aborted) throw error
    return undefined
  })
}

async function browseTagGroups(
  transport: RedashTransport,
  kinds: ChatLibraryItem['type'][],
  signal: AbortSignal
): Promise<LibraryTagGroups | undefined> {
  const [query, dashboard] = await Promise.all([
    kinds.includes('query') ? tagGroup(transport, 'queries', signal) : undefined,
    kinds.includes('dashboard') ? tagGroup(transport, 'dashboards', signal) : undefined,
  ])
  return query || dashboard ? { query, dashboard } : undefined
}

async function searchLibrary(
  request: ChatToolRequestOf<'search_library'>,
  transport: RedashTransport,
  signal: AbortSignal
): Promise<ChatToolResult> {
  const { text, kinds, tags, sort } = request.args
  const archived = request.args.archived ?? false
  const browsing = !text.trim() && tags.length === 0
  const options = { signal, tags: tags.length > 0 ? tags : undefined, archived }
  const queryOrder = sort === 'recent' ? RECENTLY_EDITED_FIRST : undefined
  const [queries, dashboards, tagGroups] = await Promise.all([
    kinds.includes('query') ? nodeCalls.searchQueries(transport, text, { ...options, order: queryOrder }) : null,
    kinds.includes('dashboard')
      ? nodeCalls.searchDashboards(transport, text, { ...options, pageSize: browsing ? DASHBOARD_LIMIT : undefined })
      : null,
    browsing && !archived ? browseTagGroups(transport, kinds, signal) : undefined,
  ])
  return libraryResult(queries, dashboards, tagGroups, archived)
}

async function showVisualization(
  request: ChatToolRequestOf<'show_visualization'>,
  transport: RedashTransport,
  signal: AbortSignal
): Promise<ChatToolResult> {
  const query = await nodeCalls.getQuery(transport, request.args.queryId, signal)
  if (!query || query.is_archived) return failedResult('saved_visualization', NOT_AVAILABLE)
  const visualization = pickVisualization(query, request.args.visualizationId)
  if (typeof visualization === 'string') return failedResult('saved_visualization', visualization)
  if (query.latest_query_data_id == null) return failedResult('saved_visualization', NO_STORED_RESULT)
  const stored = await nodeCalls.getQueryResult(transport, query.latest_query_data_id, signal)
  return savedVisualizationResult(query, visualization, stored.data, stored.retrieved_at)
}

async function openDashboard(
  request: ChatToolRequestOf<'open_dashboard'>,
  transport: RedashTransport,
  signal: AbortSignal
): Promise<ChatToolResult> {
  const dashboard = await nodeCalls.getDashboard(transport, request.args.dashboardId, signal)
  if (!dashboard || dashboard.is_archived) return failedResult('dashboard', NOT_AVAILABLE)
  return dashboardResult(dashboard)
}

function dispatch(
  request: LibraryToolRequest,
  transport: RedashTransport,
  signal: AbortSignal
): Promise<ChatToolResult> {
  switch (request.tool) {
    case 'list_data_sources':
      return listDataSources(transport, signal)
    case 'describe_data_source':
      return describeDataSource(request, transport, signal)
    case 'search_library':
      return searchLibrary(request, transport, signal)
    case 'show_visualization':
      return showVisualization(request, transport, signal)
    case 'open_dashboard':
      return openDashboard(request, transport, signal)
    case 'open_query':
      return runOpenQuery(request, transport, signal)
  }
}

export async function runLibraryTool(
  request: LibraryToolRequest,
  transport: RedashTransport,
  signal: AbortSignal
): Promise<ChatToolResult> {
  try {
    return await dispatch(request, transport, signal)
  } catch (error) {
    if (signal.aborted) throw error
    if (request.tool === 'describe_data_source') {
      return failedDataSourceSchemaResult(request.args.dataSourceId, refusal(error))
    }
    return failedResult(LIBRARY_RESULT_KIND[request.tool], refusal(error))
  }
}
