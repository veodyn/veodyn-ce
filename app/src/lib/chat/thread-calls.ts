import { withLegacyWidgets, withoutLegacyIds } from './dashboard-widgets'
import type { ChatToolName, OpenName } from './frames'
import type { SavedRunSpec } from './run-spec'
import type { RunView } from './thread-model'
import { isOpenResult, knownToolResultSchema, openToolResultSchema, type ChatToolResult, type OpenToolResult } from './tool-results'

export type RunStatus = 'running' | 'done' | 'failed'

export type CardToolName = Exclude<ChatToolName, 'run_query' | 'run_saved_query'>

export interface CallView {
  callId: string
  tool: CardToolName | OpenName
  status: RunStatus
  target: { queryId: number; visualizationId: number | null } | null
  output: ChatToolResult | OpenToolResult | null
  error: string | null
}

const CARD_TOOLS: ReadonlySet<string> = new Set<CardToolName>([
  'list_data_sources',
  'describe_data_source',
  'search_library',
  'show_visualization',
  'open_dashboard',
  'open_query',
  'show_kpi',
  'list_kpis',
  'download_result',
])

export function knownOutput(call: CallView): ChatToolResult | null {
  return call.output !== null && !isOpenResult(call.output) ? call.output : null
}

export function isCardTool(name: unknown): name is CardToolName {
  return typeof name === 'string' && CARD_TOOLS.has(name)
}

export function positiveId(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

export function savedRunView(
  callId: string,
  purpose: string,
  saved: SavedRunSpec,
  outcome: Partial<RunView> = {}
): RunView {
  return {
    callId,
    dataSourceId: 0,
    purpose,
    sql: '',
    vizChoiceId: 'table',
    status: 'running',
    rowCount: null,
    durationMs: null,
    error: null,
    ...outcome,
    saved,
  }
}

function targetOf(tool: CardToolName | OpenName, input: Record<string, unknown>): CallView['target'] {
  const queryId = positiveId(input.queryId)
  if (tool !== 'show_visualization' || queryId === null) return null
  return { queryId, visualizationId: positiveId(input.visualizationId) }
}

export function settledView(call: CallView, result: ChatToolResult | OpenToolResult): CallView {
  return {
    ...call,
    status: result.ok ? 'done' : 'failed',
    output: result,
    error: result.ok ? null : (result.error ?? null),
  }
}

export function storedCall(
  callId: string,
  tool: CardToolName | OpenName,
  input: Record<string, unknown>,
  content: Record<string, unknown>
): CallView {
  const call: CallView = { callId, tool, status: 'failed', target: targetOf(tool, input), output: null, error: null }
  const parsed = knownToolResultSchema.safeParse(withLegacyWidgets(content))
  if (parsed.success) return settledView(call, withoutLegacyIds(parsed.data))
  const open = openToolResultSchema.safeParse(content)
  if (open.success) return settledView(call, open.data)
  return { ...call, error: typeof content.error === 'string' ? content.error : null }
}

