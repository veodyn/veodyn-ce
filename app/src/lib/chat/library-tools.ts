import { readQueryError } from '@/lib/query-error'
import { ApiError } from '@/services/api-client'
import * as dashboardsService from '@/services/redash/dashboards'
import { getResult } from '@/services/redash/execution'
import * as queriesService from '@/services/redash/queries'
import type { ChatToolRequestOf } from './frames'
import {
  dashboardResult,
  libraryResult,
  NO_STORED_RESULT,
  NOT_AVAILABLE,
  pickVisualization,
  savedVisualizationResult,
} from './library-results'
import { failedResult, type ChatResultKind, type ChatToolResult } from './tool-results'

export type LibraryToolRequest = ChatToolRequestOf<'search_library' | 'show_visualization' | 'open_dashboard'>

export const LIBRARY_RESULT_KIND: Record<LibraryToolRequest['tool'], ChatResultKind> = {
  search_library: 'library',
  show_visualization: 'saved_visualization',
  open_dashboard: 'dashboard',
}

function refusal(error: unknown): string {
  if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return NOT_AVAILABLE
  return readQueryError(error).message
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
    return failedResult(LIBRARY_RESULT_KIND[request.tool], refusal(error))
  }
}
