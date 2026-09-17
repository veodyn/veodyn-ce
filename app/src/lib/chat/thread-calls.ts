import type { ChatToolName } from './frames'
import { toolResultSchema, type ChatToolResult } from './tool-results'

export type RunStatus = 'running' | 'done' | 'failed'

export type LibraryToolName = Exclude<ChatToolName, 'run_query'>

export interface CallView {
  callId: string
  tool: LibraryToolName
  status: RunStatus
  target: { queryId: number; visualizationId: number | null } | null
  output: ChatToolResult | null
  error: string | null
}

const LIBRARY_TOOLS: ReadonlySet<string> = new Set<LibraryToolName>([
  'search_library',
  'show_visualization',
  'open_dashboard',
])

export function isLibraryTool(name: unknown): name is LibraryToolName {
  return typeof name === 'string' && LIBRARY_TOOLS.has(name)
}

function positiveId(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

function targetOf(tool: LibraryToolName, input: Record<string, unknown>): CallView['target'] {
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
  tool: LibraryToolName,
  input: Record<string, unknown>,
  content: Record<string, unknown>
): CallView {
  const call: CallView = { callId, tool, status: 'failed', target: targetOf(tool, input), output: null, error: null }
  const parsed = toolResultSchema.safeParse(content)
  if (parsed.success) return settledView(call, parsed.data)
  return { ...call, error: typeof content.error === 'string' ? content.error : null }
}

