import type { ChatToolContext } from '@/features/chat-tool-types'
import { chatToolContributionFor, contributedResultKind, runContributedTool } from '@/features/chat-tools'
import { resolveDashboardEdit } from '@/lib/chat/dashboard-edit'
import { parseFrame, type ChatToolRequest, type ChatToolRequestOf } from '@/lib/chat/frames'
import { resolveKpiCheck } from '@/lib/chat/kpi-check'
import { LIBRARY_RESULT_KIND, runLibraryTool } from '@/lib/chat/library-tools'
import { isOperationRequest, OPERATION_RESULT_KIND, runOperationTool } from '@/lib/chat/operation-tools'
import { refusedOperation } from '@/lib/chat/operations'
import { resolveQueryEdit, type QueryEditFeatures } from '@/lib/chat/query-edit'
import { unavailableSidecar } from '@/lib/chat/sidecar-transport'
import { resolveSnippetCheck } from '@/lib/chat/snippet-check'
import { resolveVizChange, runDescribeVizType } from '@/lib/chat/viz-tools'
import { runAdhocQuery, runSavedQuery, savedRunResult } from '@/lib/chat/saved-query-run'
import { shapeResult } from '@/lib/chat/shape-result'
import { failedResult, type ChatResultKind, type ChatToolResult, type OpenToolResult } from '@/lib/chat/tool-results'
import type { RedashTransport } from '@/lib/chat/transport'
import { readQueryError } from '@/lib/query-error'

export const CANNOT_RUN_OUTSIDE_APP = 'This tool cannot run outside the app.'
export const UNREADABLE_ARGUMENTS = 'The arguments for this tool could not be read.'

const RESULT_KIND: Record<string, ChatResultKind> = {
  ...LIBRARY_RESULT_KIND,
  ...OPERATION_RESULT_KIND,
  run_query: 'query_result',
  run_saved_query: 'query_result',
  update_query: 'query_edit',
  update_dashboard: 'dashboard_edit',
  describe_visualization_type: 'visualization_type',
  propose_visualization: 'visualization_check',
  update_visualization: 'visualization_check',
  delete_visualization: 'visualization_check',
  update_snippet: 'snippet_check',
  delete_snippet: 'snippet_check',
  propose_kpi: 'kpi_check',
}

export interface ClientCall {
  tool: string
  args: Record<string, unknown>
}

type ServerRunnableRequest = Exclude<ChatToolRequest, ChatToolRequestOf<'show_kpi' | 'list_kpis'>>

const NO_CONTEXT: ChatToolContext = { sidecar: unavailableSidecar }

async function runQueryTool(
  request: ChatToolRequestOf<'run_query' | 'run_saved_query'>,
  transport: RedashTransport,
  signal: AbortSignal
): Promise<ChatToolResult> {
  try {
    if (request.tool === 'run_query') {
      const { sql, dataSourceId } = request.args
      const outcome = await runAdhocQuery({ sql, dataSourceId }, transport, signal)
      return shapeResult(outcome.data, outcome.dataSourceId)
    }
    const { queryId, parameters, visualizationId } = request.args
    const outcome = await runSavedQuery({ queryId, parameters, visualizationId }, transport, signal)
    return savedRunResult(outcome, queryId)
  } catch (error) {
    if (signal.aborted) throw error
    return failedResult('query_result', new Error(readQueryError(error).message))
  }
}

function execute(
  request: ServerRunnableRequest,
  transport: RedashTransport,
  signal: AbortSignal,
  features: QueryEditFeatures
): Promise<ChatToolResult> {
  if (request.tool === 'run_query' || request.tool === 'run_saved_query') {
    return runQueryTool(request, transport, signal)
  }
  if (request.tool === 'update_query') return resolveQueryEdit(request, transport, signal, features)
  if (request.tool === 'update_dashboard') return resolveDashboardEdit(request, transport, signal)
  if (request.tool === 'describe_visualization_type') return Promise.resolve(runDescribeVizType(request))
  if (
    request.tool === 'propose_visualization' ||
    request.tool === 'update_visualization' ||
    request.tool === 'delete_visualization'
  ) {
    return resolveVizChange(request, transport, signal)
  }
  if (request.tool === 'update_snippet' || request.tool === 'delete_snippet') {
    return resolveSnippetCheck(request, transport, signal)
  }
  if (request.tool === 'propose_kpi') return resolveKpiCheck(request, transport, signal)
  if (isOperationRequest(request)) return runOperationTool(request, transport, signal)
  return runLibraryTool(request, transport, signal)
}

export async function runClientCall(
  call: ClientCall,
  transport: RedashTransport,
  signal: AbortSignal,
  features: QueryEditFeatures,
  context: ChatToolContext = NO_CONTEXT
): Promise<ChatToolResult | OpenToolResult | null> {
  const contributedKind = contributedResultKind(call.tool)
  if (contributedKind !== undefined) {
    if (chatToolContributionFor(call.tool)) {
      return runContributedTool({ callId: 'mcp', tool: call.tool, args: call.args }, signal, transport, context)
    }
    return { kind: contributedKind, ok: false, error: CANNOT_RUN_OUTSIDE_APP } as OpenToolResult
  }
  if (!Object.hasOwn(RESULT_KIND, call.tool)) return null
  const kind = RESULT_KIND[call.tool]
  const frame = parseFrame('tool_request', { callId: 'mcp', tool: call.tool, args: call.args }, null)
  if (!frame || frame.event !== 'tool_request') {
    if (kind === 'data_source_schema') return null
    return kind === 'operation_check' ? refusedOperation(UNREADABLE_ARGUMENTS) : failedResult(kind, UNREADABLE_ARGUMENTS)
  }
  return execute(frame.data as ServerRunnableRequest, transport, signal, features)
}
