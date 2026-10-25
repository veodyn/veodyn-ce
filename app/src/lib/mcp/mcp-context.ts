import { instanceProfile } from '@/lib/chat/instance-profile'
import { dataSourceInventory } from '@/lib/chat/inventory'
import { getQuery } from '@/lib/chat/node-calls'
import { runLibraryTool } from '@/lib/chat/library-tools'
import { buildTurnContext } from '@/lib/chat/turn-context-builder'
import type { McpCallContext } from './registry-client'
import type { McpIdentity, McpSession } from './session'

const CONTEXT_PARTS = { instance: instanceProfile, dataSources: dataSourceInventory }

function positiveId(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

async function savedQuerySourceId(queryId: number, identity: McpIdentity, signal: AbortSignal): Promise<number | null> {
  try {
    const query = await getQuery(identity.transport, queryId, signal)
    return positiveId(query?.data_source_id)
  } catch (error) {
    if (signal.aborted) throw error
    return null
  }
}

async function effectiveDataSourceId(
  tool: string | undefined,
  args: Record<string, unknown>,
  identity: McpIdentity,
  signal: AbortSignal
): Promise<number | null> {
  if (tool !== 'update_query') return positiveId(args.dataSourceId)
  const changes = typeof args.changes === 'object' && args.changes !== null ? (args.changes as Record<string, unknown>) : {}
  const moved = positiveId(changes.dataSourceId)
  if (moved !== null) return moved
  const queryId = positiveId(args.queryId)
  return queryId === null ? null : savedQuerySourceId(queryId, identity, signal)
}

async function describedSchemas(
  tool: string | undefined,
  args: Record<string, unknown>,
  identity: McpIdentity,
  signal: AbortSignal
): Promise<McpCallContext['schemas']> {
  const dataSourceId = await effectiveDataSourceId(tool, args, identity, signal)
  if (dataSourceId === null) return undefined
  const described = await runLibraryTool(
    { callId: 'mcp', tool: 'describe_data_source', args: { dataSourceId } },
    identity.transport,
    signal
  )
  return described.kind === 'data_source_schema' && described.ok ? [described] : undefined
}

export async function buildMcpContext(
  session: McpSession,
  identity: McpIdentity,
  args: Record<string, unknown>,
  signal: AbortSignal,
  tool?: string
): Promise<McpCallContext> {
  const [turn, schemas] = await Promise.all([
    buildTurnContext(session.request, CONTEXT_PARTS, undefined, identity.reader),
    describedSchemas(tool, args, identity, signal),
  ])
  return {
    ...(turn.instance ? { instance: turn.instance } : {}),
    ...(turn.dataSources
      ? { dataSources: turn.dataSources.map((source) => ({ ...source, noSchema: source.noSchema ?? false })) }
      : {}),
    ...(schemas ? { schemas } : {}),
  }
}
