// Shared harness for the converse route suite. Not a test file itself (the name
// deliberately avoids the `.test.` pattern vitest collects): just the
// module-mocking loader and the request builders, so the suite stays well under
// the file-size limit. Mirrors generate-sql-test-harness.ts.
import { vi } from 'vitest'
import { mockConverse } from '@/lib/ai-mock'
import type { ConverseMessage, CreateKind } from '@/types/ai-create'

export const KINDS: CreateKind[] = ['query', 'dashboard', 'kpi', 'report', 'snippet']

/** A caller with an established app session cookie. */
export const SESSION = 'session=abc'

export interface LoadRouteOptions {
  enabled: boolean
  endpoint?: string | null
  key?: string
  realMode?: boolean
  /** How the mocked Redash session check answers in real mode. */
  session?: 'valid' | 'invalid'
}

export async function loadRoute(options: LoadRouteOptions) {
  vi.resetModules()
  vi.doMock('@/lib/config', () => ({
    config: { ai: { enabled: options.enabled, endpoint: options.endpoint ?? null } },
  }))
  vi.doMock('@/lib/env', () => ({
    env: {
      VEODYN_AI__KEY: options.key ?? 'server-secret-key',
      NEXT_PUBLIC_REDASH_URL: options.realMode ? 'http://redash' : undefined,
    },
  }))
  // In real mode the route validates the session against Redash. Mock that
  // round-trip so the only outbound fetch a test sees is the provider call.
  vi.doMock('@/lib/redash-server', () => ({
    requireSession: vi.fn(async (cookie: string | null) =>
      cookie && options.session !== 'invalid' ? { id: 1 } : null
    ),
  }))
  return import('./route')
}

/** A transcript of `userTurns` user messages with the assistant replying between them. */
export function transcript(userTurns: number): ConverseMessage[] {
  return Array.from({ length: userTurns * 2 - 1 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `message ${i}`,
  }))
}

export const validPayload = { kind: 'query' as const, messages: transcript(1) }

export function request(
  payload: unknown = validPayload,
  headers: Record<string, string> = {}
): Request {
  return new Request('http://localhost/api/ai/converse', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  })
}

/** A signed-in caller: the same request, plus the app session cookie. */
export function authedRequest(payload: unknown = validPayload): Request {
  return request(payload, { cookie: SESSION })
}

/** The mock's own ready turn, which doubles as a valid provider success. */
export function readyTurn(kind: CreateKind) {
  return mockConverse({ kind, messages: transcript(2) })
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Drive the route in real mode against a provider that answers `body`. */
export async function fromProvider(body: unknown, status = 200) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(body, status))
  const { POST } = await loadRoute({ enabled: true, endpoint: 'http://ai.test', realMode: true })
  return POST(authedRequest())
}
