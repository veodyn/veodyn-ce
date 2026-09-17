import { AppError, ErrorIds, isAppError } from '@/lib/errorIds'
import type {
  ChatAccepted,
  ChatPromotion,
  ChatThread,
  ChatThreadDetail,
  ChatThreadList,
  ChatToolResult,
  ChatTurnStarted,
} from '@/lib/chat/wire'

const BASE = '/api/ai/chat'

interface CallOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
}

async function call<T>(path: string, options: CallOptions = {}): Promise<T> {
  const init: RequestInit = { method: options.method ?? 'GET', credentials: 'include', signal: options.signal }
  if (options.body !== undefined) {
    init.headers = { 'content-type': 'application/json' }
    init.body = JSON.stringify(options.body)
  }
  let response: Response
  try {
    response = await fetch(`${BASE}/${path}`, init)
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    throw new AppError(ErrorIds.AI_CHAT_UNAVAILABLE, 'The data chat is unreachable', {
      cause: error instanceof Error ? error.message : String(error),
    })
  }
  if (!response.ok) {
    throw new AppError(ErrorIds.AI_REQUEST_FAILED, `Data chat request failed (${response.status})`, {
      status: response.status,
    })
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export function chatErrorStatus(error: unknown): number | null {
  if (!isAppError(error)) return null
  const status = error.context.status
  return typeof status === 'number' ? status : null
}

export function chatStreamUrl(turnId: string): string {
  return `${BASE}/turns/${encodeURIComponent(turnId)}/stream`
}

export function listThreads(offset = 0, signal?: AbortSignal): Promise<ChatThreadList> {
  return call(`threads?offset=${offset}`, { signal })
}

export function createThread(signal?: AbortSignal): Promise<ChatThread> {
  return call('threads', { method: 'POST', signal })
}

export function getThread(id: string, signal?: AbortSignal): Promise<ChatThreadDetail> {
  return call(`threads/${encodeURIComponent(id)}`, { signal })
}

export function updateThread(id: string, patch: { title?: string; pinned?: boolean }): Promise<ChatThread> {
  return call(`threads/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch })
}

export function deleteThread(id: string): Promise<void> {
  return call(`threads/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function postTurn(threadId: string, text: string, signal?: AbortSignal): Promise<ChatTurnStarted> {
  return call(`threads/${encodeURIComponent(threadId)}/turns`, { method: 'POST', body: { text }, signal })
}

export function postToolResult(turnId: string, callId: string, result: ChatToolResult): Promise<ChatAccepted> {
  return call(`turns/${encodeURIComponent(turnId)}/tool-results`, { method: 'POST', body: { callId, result } })
}

export function cancelTurn(turnId: string): Promise<ChatAccepted> {
  return call(`turns/${encodeURIComponent(turnId)}/cancel`, { method: 'POST' })
}

export function recordPromotion(
  draftId: string,
  body: { version: number; targetType: 'query'; targetId: string; targetVersionAtPromote: number | null }
): Promise<ChatPromotion> {
  return call(`drafts/${encodeURIComponent(draftId)}/promotions`, { method: 'POST', body })
}
