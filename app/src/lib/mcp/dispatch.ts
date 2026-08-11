// Turning one parsed JSON-RPC message into one response.
//
// Kept apart from the route handler so the whole protocol surface can be
// exercised without an HTTP layer, and apart from the tool handlers so those
// stay plain functions returning plain data.

import {
  failure,
  initializeResult,
  isNotification,
  JSON_RPC_ERRORS,
  success,
  toolJson,
  toolText,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type ServerIdentity,
} from '@/lib/mcp/protocol'
import { McpUnauthorized, type McpCredential } from '@/lib/mcp/redash-caller'
import { MCP_TOOLS } from '@/lib/mcp/tool-schemas'
import { getQuery, listQueries, runQuery, type RunQueryClock } from '@/lib/mcp/query-tools'
import { getDashboard, listDashboards } from '@/lib/mcp/dashboard-tools'
import { RedashError } from '@/lib/redash-server'

type ToolHandler = (
  args: Record<string, unknown>,
  credential: McpCredential,
  clock: RunQueryClock,
  signal?: AbortSignal
) => Promise<unknown>

const HANDLERS: Record<string, ToolHandler> = {
  list_queries: (args, credential, _clock, signal) => listQueries(args, credential, signal),
  get_query: (args, credential, _clock, signal) => getQuery(args, credential, signal),
  run_query: (args, credential, clock, signal) => runQuery(args, credential, clock, signal),
  list_dashboards: (args, credential, _clock, signal) => listDashboards(args, credential, signal),
  get_dashboard: (args, credential, _clock, signal) => getDashboard(args, credential, signal),
}

export interface DispatchContext {
  credential: McpCredential
  server: ServerIdentity
  clock?: RunQueryClock
  /**
   * The incoming request's signal. A client that hangs up should not leave this
   * server polling a Redash job on its behalf.
   */
  signal?: AbortSignal
}

/**
 * A tool that fails reports it as a successful JSON-RPC result carrying
 * isError, per MCP: the model is supposed to see what went wrong and adjust,
 * and a transport-level error hides it from the model entirely.
 */
async function callTool(
  params: Record<string, unknown> | undefined,
  context: DispatchContext
): Promise<unknown> {
  const name = typeof params?.name === 'string' ? params.name : ''
  const handler = HANDLERS[name]
  if (!handler) {
    return toolText(`No tool named "${name}". Call tools/list to see what this server offers.`, true)
  }
  const args =
    typeof params?.arguments === 'object' && params.arguments !== null
      ? (params.arguments as Record<string, unknown>)
      : {}

  try {
    return toolJson(await handler(args, context.credential, context.clock ?? {}, context.signal))
  } catch (error) {
    return toolText(describeToolError(error), true)
  }
}

function describeToolError(error: unknown): string {
  if (error instanceof McpUnauthorized) return error.message
  if (error instanceof RedashError) {
    if (error.status === 404) return 'No such object on this instance.'
    return `Redash refused the request (${error.status}).`
  }
  if (error instanceof TypeError) return `Bad arguments: ${error.message}`
  if (error instanceof Error) return error.message
  return 'The tool failed for an unknown reason.'
}

/** Returns null for a notification, which by definition gets no reply. */
export async function dispatch(
  message: JsonRpcRequest,
  context: DispatchContext
): Promise<JsonRpcResponse | null> {
  const answer = await answerFor(message, context)
  // Checked in one place rather than per method. A message with no id is a
  // notification, and JSON-RPC forbids replying to one whatever the method was.
  // Handling it per case meant `{"method":"tools/list"}` with no id still got a
  // response object carrying `id: null`, which a strict client rejects.
  return isNotification(message) ? null : answer
}

async function answerFor(
  message: JsonRpcRequest,
  context: DispatchContext
): Promise<JsonRpcResponse | null> {
  const id = message.id ?? null

  switch (message.method) {
    case 'initialize':
      return success(id, initializeResult(message.params?.protocolVersion, context.server))

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null

    case 'ping':
      // The spec's keepalive: an empty result is the whole answer.
      return success(id, {})

    case 'tools/list':
      return success(id, { tools: MCP_TOOLS })

    case 'tools/call':
      return success(id, await callTool(message.params, context))

    default:
      return failure(id, JSON_RPC_ERRORS.METHOD_NOT_FOUND, `Unknown method: ${message.method}`)
  }
}
