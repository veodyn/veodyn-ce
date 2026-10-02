import type { ChatToolName } from './frames'
import { toolResultSchema, type ChatToolResult } from './tool-results'

export type RunStatus = 'running' | 'done' | 'failed'

/** Every client-executed tool that renders as a generic call card, i.e. every
 * tool but run_query (which gets its own RunView/RunCard). Not "library"
 * specific any more: list_data_sources and describe_data_source render this
 * way too, even though neither reaches the library. */
export type CardToolName = Exclude<ChatToolName, 'run_query'>

export interface CallView {
  callId: string
  tool: CardToolName
  status: RunStatus
  target: { queryId: number; visualizationId: number | null } | null
  output: ChatToolResult | null
  error: string | null
}

const CARD_TOOLS: ReadonlySet<string> = new Set<CardToolName>([
  'list_data_sources',
  'describe_data_source',
  'search_library',
  'show_visualization',
  'open_dashboard',
])

export function isCardTool(name: unknown): name is CardToolName {
  return typeof name === 'string' && CARD_TOOLS.has(name)
}

function positiveId(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

function targetOf(tool: CardToolName, input: Record<string, unknown>): CallView['target'] {
  const queryId = positiveId(input.queryId)
  if (tool !== 'show_visualization' || queryId === null) return null
  return { queryId, visualizationId: positiveId(input.visualizationId) }
}

export function settledView(call: CallView, result: ChatToolResult): CallView {
  return {
    ...call,
    status: result.ok ? 'done' : 'failed',
    output: result,
    error: result.ok ? null : (result.error ?? null),
  }
}

export function storedCall(
  callId: string,
  tool: CardToolName,
  input: Record<string, unknown>,
  content: Record<string, unknown>
): CallView {
  const call: CallView = { callId, tool, status: 'failed', target: targetOf(tool, input), output: null, error: null }
  const parsed = toolResultSchema.safeParse(content)
  if (parsed.success) return settledView(call, parsed.data)
  return { ...call, error: typeof content.error === 'string' ? content.error : null }
}

