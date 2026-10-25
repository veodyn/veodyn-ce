import { vi } from 'vitest'
import type { McpCredential } from '@/lib/mcp/redash-caller'

export const REDASH = 'http://redash.test'
export const ENDPOINT = 'http://ai.test/ai'
export const SECRET = 'a-token-secret-of-sufficient-length'
export const RELAY_KEY = 'relay-key'
export const KEY_CREDENTIAL: McpCredential = { apiKey: 'abc123', session: null, csrfToken: null }

export interface FakeBackend {
  nodeCalls: { url: string; init: RequestInit | undefined }[]
  sidecarCalls: { path: string; headers: Headers; body: unknown }[]
  sidecar: (path: string, body: unknown, headers: Headers) => Response | Promise<Response>
  node: (url: string, init: RequestInit | undefined) => Response | Promise<Response>
  userId: number
  session?: () => Response
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

export function fakeBackend(overrides: Partial<FakeBackend> = {}): FakeBackend {
  const backend: FakeBackend = {
    nodeCalls: [],
    sidecarCalls: [],
    userId: 7,
    sidecar: () => jsonResponse({}, 404),
    node: () => jsonResponse({}, 404),
    ...overrides,
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith(ENDPOINT)) {
        const body = init?.body ? JSON.parse(String(init.body)) : undefined
        const headers = new Headers(init?.headers as HeadersInit)
        const path = url.slice(ENDPOINT.length)
        backend.sidecarCalls.push({ path, headers, body })
        return backend.sidecar(path, body, headers)
      }
      backend.nodeCalls.push({ url, init })
      if (url === `${REDASH}/api/session`) {
        return backend.session ? backend.session() : jsonResponse({ user: { id: backend.userId } })
      }
      return backend.node(url, init)
    })
  )
  return backend
}

export interface RelaySettings {
  key?: string
  secret?: string
  aiEnabled?: boolean
  endpoint?: string | null
  drafts?: boolean
  redash?: boolean
}

export async function loadWithRelay<T>(load: () => Promise<T>, settings: RelaySettings = {}): Promise<T> {
  vi.resetModules()
  if (settings.redash === false) delete process.env.REDASH_URL
  else process.env.REDASH_URL = REDASH
  vi.doMock('@/lib/env', async (importOriginal) => {
    const original = await importOriginal<typeof import('@/lib/env')>()
    return {
      ...original,
      env: {
        ...original.env,
        VEODYN_AI__KEY: settings.key ?? RELAY_KEY,
        VEODYN_AI__TOKEN_SECRET: settings.secret ?? SECRET,
      },
    }
  })
  vi.doMock('@/lib/config', async (importOriginal) => {
    const original = await importOriginal<typeof import('@/lib/config')>()
    return {
      ...original,
      config: {
        ...original.config,
        ai: {
          enabled: settings.aiEnabled ?? true,
          endpoint: settings.endpoint === undefined ? ENDPOINT : settings.endpoint,
        },
        features: { ...original.config.features, query_drafts: settings.drafts ?? false },
      },
    }
  })
  return load()
}

export function unloadRelay(): void {
  vi.doUnmock('@/lib/env')
  vi.doUnmock('@/lib/config')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete process.env.REDASH_URL
}

export function request(url = 'https://app.example/mcp', init: RequestInit = {}): Request {
  return new Request(url, { method: 'POST', ...init })
}
