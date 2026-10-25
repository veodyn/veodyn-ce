import { isOpenResult, type ChatToolResult, type OpenToolResult } from './tool-results'

export function refusedFallback(result: ChatToolResult | OpenToolResult, status: number): ChatToolResult | OpenToolResult {
  const base = { kind: result.kind, ok: false, error: `The result could not be sent to chat: it was refused (${status}).` }
  if (isOpenResult(result)) return base as OpenToolResult
  if (result.kind === 'data_source_schema') return { ...base, kind: result.kind, dataSourceId: result.dataSourceId }
  return base as ChatToolResult
}
