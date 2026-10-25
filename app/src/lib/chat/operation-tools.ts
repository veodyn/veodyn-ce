import { resolveDownload } from './download'
import type { ChatToolRequest, ChatToolRequestOf } from './frames'
import { OPERATION_TOOLS, type OperationToolName } from './operation-changes'
import { resolveOperation } from './operations'
import type { ChatResultKind, ChatToolResult } from './tool-results'
import type { RedashTransport } from './transport'

export type OperationToolRequest = ChatToolRequestOf<OperationToolName>

export const OPERATION_RESULT_KIND = {
  fork_query: 'operation_check',
  archive_query: 'operation_check',
  archive_dashboard: 'operation_check',
  set_favorite: 'operation_check',
  share_dashboard: 'operation_check',
  share_visualization: 'operation_check',
  download_result: 'download',
} as const satisfies Record<OperationToolName, ChatResultKind>

export function isOperationRequest(request: ChatToolRequest): request is OperationToolRequest {
  return OPERATION_TOOLS.has(request.tool)
}

export function runOperationTool(
  request: OperationToolRequest,
  transport: RedashTransport,
  signal: AbortSignal
): Promise<ChatToolResult> {
  if (request.tool === 'download_result') return resolveDownload(request, transport, signal)
  return resolveOperation(request, transport, signal)
}
