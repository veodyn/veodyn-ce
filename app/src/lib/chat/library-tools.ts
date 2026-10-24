import { readQueryError } from '@/lib/query-error'
import type { TagSuggestion } from '@/lib/tags'
import { ApiError } from '@/services/api-client'
import * as dashboardsService from '@/services/redash/dashboards'
import * as dataSourcesService from '@/services/redash/data-sources'
import { getResult } from '@/services/redash/execution'
import * as queriesService from '@/services/redash/queries'
import { fetchRedashTagVocabulary, type RedashTagScope } from '@/services/tags/client'
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
import { failedResult, type ChatLibraryItem, type ChatResultKind, type ChatToolResult } from './tool-results'

export type LibraryToolRequest = ChatToolRequestOf<
  'list_data_sources' | 'describe_data_source' | 'search_library' | 'show_visualization' | 'open_dashboard'
>

export const LIBRARY_RESULT_KIND = {
  list_data_sources: 'data_sources',
  describe_data_source: 'data_source_schema',
  search_library: 'library',
  show_visualization: 'saved_visualization',
  open_dashboard: 'dashboard',
} as const satisfies Record<LibraryToolRequest['tool'], ChatResultKind>

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

function tagGroup(scope: RedashTagScope, signal: AbortSignal): Promise<TagSuggestion[] | undefined> {
  return fetchRedashTagVocabulary(scope, { signal }).catch((error: unknown) => {
    if (signal.aborted) throw error
    return undefined
  })
}

async function browseTagGroups(
  kinds: ChatLibraryItem['type'][],
  signal: AbortSignal
): Promise<LibraryTagGroups | undefined> {
  const [query, dashboard] = await Promise.all([
    kinds.includes('query') ? tagGroup('queries', signal) : undefined,
    kinds.includes('dashboard') ? tagGroup('dashboards', signal) : undefined,
  ])
  return query || dashboard ? { query, dashboard } : undefined
}

async function searchLibrary(
  request: ChatToolRequestOf<'search_library'>,
  signal: AbortSignal
): Promise<ChatToolResult> {
  const { text, kinds, tags } = request.args
  const browsing = !text.trim() && tags.length === 0
  const options = { signal, tags: tags.length > 0 ? tags : undefined }
  const [queries, dashboards, tagGroups] = await Promise.all([
    kinds.includes('query') ? queriesService.search(text, options) : null,
    kinds.includes('dashboard')
      ? dashboardsService.search(text, { ...options, pageSize: browsing ? DASHBOARD_LIMIT : undefined })
      : null,
    browsing ? browseTagGroups(kinds, signal) : undefined,
  ])
  return libraryResult(queries, dashboards, tagGroups)
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
    if (request.tool === 'describe_data_source') {
      return failedDataSourceSchemaResult(request.args.dataSourceId, refusal(error))
    }
    return failedResult(LIBRARY_RESULT_KIND[request.tool], refusal(error))
  }
}
