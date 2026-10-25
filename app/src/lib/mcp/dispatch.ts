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
import { callRegistry, listTools } from '@/lib/mcp/registry-dispatch'
import { RegistryError } from '@/lib/mcp/registry-client'
import type { McpSession } from '@/lib/mcp/session'
import { LEGACY_TOOL_NAMES } from '@/lib/mcp/tool-schemas'
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
  session?: McpSession
  signal?: AbortSignal
}

const NEVER_ABORTED = new AbortController().signal

function usesLegacyHandler(name: string, args: Record<string, unknown>): boolean {
  if (LEGACY_TOOL_NAMES.has(name)) return true
  return name === 'run_query' && args.query_id !== undefined
}

async function callTool(
  params: Record<string, unknown> | undefined,
  context: DispatchContext
): Promise<unknown> {
  const name = typeof params?.name === 'string' ? params.name : ''
  const args =
    typeof params?.arguments === 'object' && params.arguments !== null
      ? (params.arguments as Record<string, unknown>)
      : {}

  try {
    if (usesLegacyHandler(name, args)) {
      const handler = HANDLERS[name]
      return toolJson(await handler(args, context.credential, context.clock ?? {}, context.signal))
    }
    return await callRegistry(context.session, name, args, context.signal ?? NEVER_ABORTED)
  } catch (error) {
    return toolText(describeToolError(error), true)
  }
}

function describeToolError(error: unknown): string {
  if (error instanceof McpUnauthorized) return error.message
  if (error instanceof RegistryError) return error.message
  if (error instanceof RedashError) {
    if (error.status === 404) return 'No such object on this instance.'
    return `Redash refused the request (${error.status}).`
  }
  if (error instanceof TypeError) return `Bad arguments: ${error.message}`
  if (error instanceof Error) return error.message
  return 'The tool failed for an unknown reason.'
}

export async function dispatch(
  message: JsonRpcRequest,
  context: DispatchContext
): Promise<JsonRpcResponse | null> {
  if (isNotification(message) && message.method !== 'tools/call') return null
  const answer = await answerFor(message, context)
  return isNotification(message) ? null : answer
}

async function toolsList(id: JsonRpcRequest['id'], context: DispatchContext): Promise<JsonRpcResponse> {
  const listing = await listTools(context.session, context.signal ?? NEVER_ABORTED)
  if (!listing.ok) return failure(id ?? null, JSON_RPC_ERRORS.INVALID_REQUEST, listing.message)
  return success(id ?? null, { tools: listing.tools })
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
      return success(id, {})

    case 'tools/list':
      return toolsList(id, context)

    case 'tools/call':
      return success(id, await callTool(message.params, context))

    default:
      return failure(id, JSON_RPC_ERRORS.METHOD_NOT_FOUND, `Unknown method: ${message.method}`)
  }
}
