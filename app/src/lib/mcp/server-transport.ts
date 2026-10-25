import { ApiError } from '@/services/api-client'
import type { ContextReader } from '@/lib/chat/redash-get'
import type { RedashTransport, TransportParams } from '@/lib/chat/transport'
import { RedashError } from '@/lib/redash-server'
import { callRedash, type McpCredential } from './redash-caller'

function withQuery(path: string, params: TransportParams | undefined): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) query.append(key, String(item))
    } else {
      query.set(key, String(value))
    }
  }
  const text = query.toString()
  return text ? `/api/${path}?${text}` : `/api/${path}`
}

async function asApiError<T>(call: Promise<T>): Promise<T> {
  try {
    return await call
  } catch (error) {
    if (error instanceof RedashError) throw new ApiError(error.status, error.body || error.message)
    throw error
  }
}

export function serverTransport(credential: McpCredential): RedashTransport {
  return {
    get: <T>(path: string, params?: TransportParams, signal?: AbortSignal) =>
      asApiError(callRedash<T>(withQuery(path, params), credential, { signal })),
    post: <T>(path: string, body: unknown, signal?: AbortSignal) =>
      asApiError(callRedash<T>(withQuery(path, undefined), credential, { method: 'POST', body, signal })),
    del: <T>(path: string, params?: TransportParams, signal?: AbortSignal) =>
      asApiError(callRedash<T>(withQuery(path, params), credential, { method: 'DELETE', signal })),
  }
}

export function credentialReader(credential: McpCredential, key: string): ContextReader {
  return {
    key,
    get: async <T>(path: string, signal: AbortSignal) => {
      try {
        return await callRedash<T>(path, credential, { signal })
      } catch {
        return null
      }
    },
  }
}
