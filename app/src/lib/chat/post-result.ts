import { chatErrorStatus, postToolResult } from '@/services/ai/chat-client'
import { refusedFallback } from './result-fallback'
import type { ChatToolResult, OpenToolResult } from './tool-results'

const CLIENT_ERROR_FLOOR = 400
const SERVER_ERROR_FLOOR = 500

export async function postToolResultSafely(turnId: string, callId: string, result: ChatToolResult | OpenToolResult): Promise<void> {
  try {
    await postToolResult(turnId, callId, result)
  } catch (error) {
    const status = chatErrorStatus(error)
    if (status === null || status < CLIENT_ERROR_FLOOR || status >= SERVER_ERROR_FLOOR) return
    await postToolResult(turnId, callId, refusedFallback(result, status)).catch(() => undefined)
  }
}
