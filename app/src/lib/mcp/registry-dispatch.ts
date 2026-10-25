import { instanceProfile } from '@/lib/chat/instance-profile'
import { refusedFallback } from '@/lib/chat/result-fallback'
import type { ChatToolResult, OpenToolResult } from '@/lib/chat/tool-results'
import { config } from '@/lib/config'
import { buildMcpContext } from './mcp-context'
import { toolText } from './protocol'
import {
  callRegistryTool,
  listRegistryTools,
  postRegistryResult,
  RegistryError,
  type RegistryClientCall,
  type RegistryDone,
  type RegistryOutcome,
} from './registry-client'
import { legacyOnlyToolList, mergedToolList, type ListedTool } from './registry-tools'
import { runClientCall, CANNOT_RUN_OUTSIDE_APP } from './run-client-call'
import type { McpIdentity, McpSession } from './session'

export const CREDENTIAL_NOT_ACCEPTED = 'This instance did not accept your credentials.'
export function unknownTool(name: string): string {
  return `No tool named "${name}". Call tools/list to see what this server offers.`
}
export const NO_SUCH_THREAD = 'No such conversation, or it is not yours.'

const CLIENT_ERROR_FLOOR = 400
const SERVER_ERROR_FLOOR = 500

export type ToolListing = { ok: true; tools: ListedTool[] } | { ok: false; message: string }

export async function listTools(session: McpSession | undefined, signal: AbortSignal): Promise<ToolListing> {
  if (!session) return { ok: true, tools: legacyOnlyToolList() }
  const identity = await session.identity()
  if (!identity) return { ok: false, message: CREDENTIAL_NOT_ACCEPTED }
  try {
    const registry = await listRegistryTools(identity.token, instanceProfile(), session.chatEnabled, signal)
    return { ok: true, tools: mergedToolList(registry) }
  } catch (error) {
    if (signal.aborted) throw error
    return { ok: true, tools: legacyOnlyToolList() }
  }
}

function rendered(done: RegistryDone, origin: string) {
  const blocks = [{ type: 'text', text: done.content }]
  if (done.draft) blocks.push({ type: 'text', text: `Review and apply: ${origin}${done.draft.url}` })
  return { content: blocks, isError: done.isError }
}

async function postResultOnce(
  identity: McpIdentity,
  callId: string,
  result: ChatToolResult | OpenToolResult,
  signal: AbortSignal
): Promise<RegistryDone> {
  try {
    return await postRegistryResult(identity.token, callId, result, signal)
  } catch (error) {
    if (!(error instanceof RegistryError)) throw error
    if (error.status < CLIENT_ERROR_FLOOR || error.status >= SERVER_ERROR_FLOOR) throw error
    return postRegistryResult(identity.token, callId, refusedFallback(result, error.status), signal)
  }
}

async function finishClientCall(
  call: RegistryClientCall,
  identity: McpIdentity,
  signal: AbortSignal
): Promise<RegistryDone | null> {
  const result = await runClientCall(
    { tool: call.tool, args: call.args },
    identity.transport,
    signal,
    { queryDrafts: config.features.query_drafts },
    { sidecar: identity.sidecar }
  )
  return result ? postResultOnce(identity, call.callId, result, signal) : null
}

async function startCall(
  identity: McpIdentity,
  name: string,
  args: Record<string, unknown>,
  session: McpSession,
  signal: AbortSignal
): Promise<RegistryOutcome | null> {
  const context = await buildMcpContext(session, identity, args, signal, name)
  try {
    return await callRegistryTool(identity.token, name, args, context, signal)
  } catch (error) {
    if (error instanceof RegistryError && error.status === 404) return null
    throw error
  }
}

export async function callRegistry(
  session: McpSession | undefined,
  name: string,
  args: Record<string, unknown>,
  signal: AbortSignal
) {
  if (!session) return toolText(unknownTool(name), true)
  const identity = await session.identity()
  if (!identity) return toolText(CREDENTIAL_NOT_ACCEPTED, true)
  const outcome = await startCall(identity, name, args, session, signal)
  if (!outcome) return toolText(NO_SUCH_THREAD, true)
  const done = outcome.kind === 'done' ? outcome : await finishClientCall(outcome, identity, signal)
  return done ? rendered(done, session.origin) : toolText(CANNOT_RUN_OUTSIDE_APP, true)
}
