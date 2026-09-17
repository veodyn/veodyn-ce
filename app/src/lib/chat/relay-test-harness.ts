import { vi } from 'vitest'
import { mintAiToken } from '@/lib/ai-token'

export const SECRET = 'chat-token-secret'
export const ENDPOINT = 'http://sidecar.test/ai'
export const THREAD = '6f1f7a4e-1a4b-4a51-9c3a-3f3d0f8b1c11'

export interface ChatRelayOptions {
  enabled?: boolean
  chat?: boolean
  realMode?: boolean
  endpoint?: string | null
}

export function mockChatModules(options: ChatRelayOptions = {}) {
  vi.resetModules()
  vi.doMock('@/lib/config', () => ({
    config: {
      ai: {
        enabled: options.enabled ?? true,
        chat: options.chat ?? true,
        endpoint: options.endpoint === undefined ? ENDPOINT : options.endpoint,
      },
    },
  }))
  vi.doMock('@/lib/env', () => ({
    env: {
      VEODYN_AI__KEY: 'relay-key',
      VEODYN_AI__TOKEN_SECRET: SECRET,
      NEXT_PUBLIC_REDASH_URL: (options.realMode ?? true) ? 'http://redash' : undefined,
    },
  }))
  vi.doMock('@/lib/redash-server', () => ({ requireSession: vi.fn(async () => ({ id: 7 })) }))
}

export function unmockChatModules() {
  vi.doUnmock('@/lib/config')
  vi.doUnmock('@/lib/env')
  vi.doUnmock('@/lib/redash-server')
  vi.unstubAllGlobals()
  vi.resetModules()
}

export function signedIn(init: RequestInit & { url?: string } = {}): Request {
  const { url, headers, ...rest } = init
  return new Request(url ?? 'http://localhost/api/ai/chat/threads', {
    ...rest,
    headers: { cookie: `session=s; veodyn_ai=${mintAiToken(7, SECRET)}`, ...(headers as Record<string, string>) },
  })
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

export function thread(overrides: Record<string, unknown> = {}) {
  return {
    id: THREAD,
    title: 'Speeds',
    pinned: false,
    createdAt: '2026-09-17T00:00:00Z',
    updatedAt: '2026-09-17T00:00:00Z',
    lastTurnAt: '2026-09-17T00:00:00Z',
    ...overrides,
  }
}
