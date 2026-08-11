// Shared setup for the MCP tool tests, which are split by tool group so no one
// file grows past the size the repo keeps them under.
import { vi } from 'vitest'
import type { McpCredential } from '@/lib/mcp/redash-caller'

export const REDASH = 'http://redash.test'

/** An API-key caller: the shape an MCP client authenticates with. */
export const CREDENTIAL: McpCredential = { apiKey: 'abc123', session: null, csrfToken: null }

/** A browser caller: session cookie plus the CSRF token Redash requires. */
export const SESSION_CREDENTIAL: McpCredential = {
  apiKey: null,
  session: 'sess-1',
  csrfToken: 'csrf-1',
}

/** Re-imported per test: the module reads REDASH_URL once, at import. */
export async function loadQueryTools(): Promise<typeof import('@/lib/mcp/query-tools')> {
  vi.resetModules()
  process.env.REDASH_URL = REDASH
  return import('@/lib/mcp/query-tools')
}

export async function loadDashboardTools(): Promise<typeof import('@/lib/mcp/dashboard-tools')> {
  vi.resetModules()
  process.env.REDASH_URL = REDASH
  return import('@/lib/mcp/dashboard-tools')
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Replies in order, one per call, so a poll sequence can be scripted. */
export function mockFetchSequence(responses: Response[]) {
  const spy = vi.spyOn(globalThis, 'fetch')
  for (const response of responses) spy.mockResolvedValueOnce(response)
  return spy
}

/** A clock the test drives, so a 30s timeout does not take 30s to prove. */
export function fakeClock(start = 0) {
  let current = start
  return {
    now: () => current,
    sleep: async (ms: number) => {
      current += ms
    },
  }
}
