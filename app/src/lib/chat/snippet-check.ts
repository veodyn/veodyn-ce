import { readQueryError } from '@/lib/query-error'
import { ApiError } from '@/services/api-client'
import type { ChatToolRequestOf } from './frames'
import { NOT_AVAILABLE } from './library-results'
import type { ChatToolResult } from './tool-results'
import type { ChatSnippetCheckResult } from './tool-results-contributed'
import type { RedashTransport } from './transport'

export const CANNOT_CHANGE_SNIPPET = 'You cannot change this snippet: only its owner or an admin can.'
export const SNIPPET_TOO_LONG = 'This snippet is longer than chat can carry; change it on the snippets page.'

const MAX_TRIGGER_CHARS = 255
const MAX_BODY_CHARS = 10_000
const MAX_DESCRIPTION_CHARS = 1_000
const FIELDS = ['trigger', 'snippet', 'description'] as const

interface StoredSnippet {
  id: number
  trigger: string
  description: string | null
  snippet: string
  user?: { id: number }
  updated_at: string
}

interface SessionUser {
  user?: { id?: number; permissions?: string[] }
}

export function noSnippet(snippetId: number): string {
  return `No snippet ${snippetId}`
}

function failed(error: string): ChatToolResult {
  return { kind: 'snippet_check', ok: false, error } as ChatSnippetCheckResult
}

async function mayChange(snippet: StoredSnippet, transport: RedashTransport, signal: AbortSignal): Promise<boolean> {
  try {
    const session = await transport.get<SessionUser>('session', undefined, signal)
    const id = session.user?.id
    if (typeof id !== 'number') return true
    return id === snippet.user?.id || (session.user?.permissions ?? []).includes('admin')
  } catch {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    return true
  }
}

function tooLong(snippet: StoredSnippet): boolean {
  return (
    snippet.trigger.length > MAX_TRIGGER_CHARS ||
    snippet.snippet.length > MAX_BODY_CHARS ||
    (snippet.description ?? '').length > MAX_DESCRIPTION_CHARS
  )
}

export async function resolveSnippetCheck(
  request: ChatToolRequestOf<'update_snippet' | 'delete_snippet'>,
  transport: RedashTransport,
  signal: AbortSignal
): Promise<ChatToolResult> {
  const { snippetId } = request.args
  try {
    const stored = await transport.get<StoredSnippet>(`query_snippets/${snippetId}`, undefined, signal)
    if (!(await mayChange(stored, transport, signal))) return failed(CANNOT_CHANGE_SNIPPET)
    if (tooLong(stored)) return failed(SNIPPET_TOO_LONG)
    const snapshot = {
      trigger: stored.trigger,
      snippet: stored.snippet,
      description: stored.description ?? '',
      updatedAt: stored.updated_at,
    }
    if (request.tool === 'delete_snippet') {
      return { kind: 'snippet_check', ok: true, mode: 'delete', snippetId, snapshot }
    }
    const changes: Record<string, string> = {}
    for (const field of FIELDS) {
      const wanted = request.args[field]
      if (wanted !== undefined && wanted !== snapshot[field]) changes[field] = wanted
    }
    return { kind: 'snippet_check', ok: true, mode: 'edit', snippetId, snapshot, changes }
  } catch (error) {
    if (signal.aborted) throw error
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
      return failed(error.status === 404 ? noSnippet(snippetId) : NOT_AVAILABLE)
    }
    return failed(readQueryError(error).message)
  }
}
