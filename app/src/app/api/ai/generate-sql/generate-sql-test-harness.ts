// Shared harness for the generate-sql route suites. Not a test file itself (the
// name deliberately avoids the `.test.` pattern vitest collects): just the
// module-mocking loader and request builders both route suites need, so each
// file stays well under the file-size limit.
import { vi } from 'vitest'

export interface LoadRouteOptions {
  enabled: boolean
  endpoint?: string | null
  key?: string
  realMode?: boolean
  /** How the mocked Redash session check answers in real mode. */
  session?: 'valid' | 'invalid'
}

export const validPayload = {
  prompt: 'boardings by route',
  dataset: {
    table: 't',
    columns: [{ name: 'boardings', type: 'integer' }],
  },
}

// A caller with an established app session cookie. The route authenticates the
// caller before it will spend the instance AI key or run the mock.
export const SESSION = 'session=abc'

// Records the abort signal the route hands to requireSession, so a suite can
// prove the caller's cancellation reaches the session validation round-trip.
export const sessionValidationSignals: (AbortSignal | undefined)[] = []

export async function loadRoute(options: LoadRouteOptions) {
  vi.resetModules()
  vi.doMock('@/lib/config', () => ({
    config: {
      ai: {
        enabled: options.enabled,
        endpoint: options.endpoint ?? null,
      },
    },
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
    requireSession: vi.fn(async (cookie: string | null, signal?: AbortSignal) => {
      sessionValidationSignals.push(signal)
      return cookie && options.session !== 'invalid' ? { id: 1 } : null
    }),
  }))
  return import('./route')
}

export function request(
  payload: unknown = validPayload,
  headers: Record<string, string> = {}
): Request {
  return new Request('http://localhost/api/ai/generate-sql', {
    method: 'POST',
    headers,
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  })
}

// A signed-in caller: same body, plus the app session cookie.
export function authedRequest(
  payload: unknown = validPayload,
  headers: Record<string, string> = {}
): Request {
  return request(payload, { cookie: SESSION, ...headers })
}
