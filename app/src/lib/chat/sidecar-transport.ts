import { ApiError } from '@/services/api-client'
import type { TransportParams } from './transport'

export interface SidecarTransport {
  get<T>(path: string, params?: TransportParams, signal?: AbortSignal): Promise<T>
  post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T>
  patch<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T>
}

export interface SidecarTransportSource {
  address: (path: string) => string
  headers: () => Record<string, string>
  credentials?: RequestCredentials
  fetcher?: typeof fetch
}

export function withQuery(address: string, params: TransportParams | undefined): string {
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
  return text ? `${address}?${text}` : address
}

function messageOf(body: string, status: number): string {
  try {
    const parsed: unknown = JSON.parse(body)
    if (parsed && typeof parsed === 'object') {
      const { message, error, detail } = parsed as Record<string, unknown>
      for (const candidate of [message, error, detail]) {
        if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
      }
    }
  } catch {
    if (body.trim()) return body.trim()
  }
  return `Request failed (${status})`
}

export function createSidecarTransport(source: SidecarTransportSource): SidecarTransport {
  async function send<T>(
    method: string,
    path: string,
    params: TransportParams | undefined,
    body: unknown,
    signal: AbortSignal | undefined
  ): Promise<T> {
    const fetcher = source.fetcher ?? fetch
    const response = await fetcher(withQuery(source.address(path), params), {
      method,
      signal,
      credentials: source.credentials,
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...source.headers(),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response.ok) throw new ApiError(response.status, messageOf(await response.text(), response.status))
    if (response.status === 204 || response.status === 205) return undefined as T
    return (await response.json()) as T
  }

  return {
    get: (path, params, signal) => send('GET', path, params, undefined, signal),
    post: (path, body, signal) => send('POST', path, undefined, body ?? {}, signal),
    patch: (path, body, signal) => send('PATCH', path, undefined, body ?? {}, signal),
  }
}

export const browserSidecarTransport: SidecarTransport = createSidecarTransport({
  address: (path) => `/api/${path.replace(/^\/+/, '')}`,
  headers: () => ({}),
  credentials: 'same-origin',
})

export const NO_SIDECAR_MESSAGE = 'The sidecar is not reachable from here.'

export const unavailableSidecar: SidecarTransport = {
  get: () => Promise.reject(new Error(NO_SIDECAR_MESSAGE)),
  post: () => Promise.reject(new Error(NO_SIDECAR_MESSAGE)),
  patch: () => Promise.reject(new Error(NO_SIDECAR_MESSAGE)),
}
