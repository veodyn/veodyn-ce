import { redashApi } from '@/services/api-client'

export type TransportParams = Record<string, string | number | boolean | undefined | Array<string | number>>

export interface TransportLimits {
  maxBytes?: number
}

export interface RedashTransport {
  get<T>(path: string, params?: TransportParams, signal?: AbortSignal, limits?: TransportLimits): Promise<T>
  post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T>
  del<T>(path: string, params?: TransportParams, signal?: AbortSignal): Promise<T>
}

export const browserTransport: RedashTransport = {
  get: <T>(path: string, params?: TransportParams, signal?: AbortSignal, limits?: TransportLimits) =>
    redashApi.get<T>(path, { params, signal, maxBytes: limits?.maxBytes }),
  post: <T>(path: string, body: unknown, signal?: AbortSignal) => redashApi.post<T>(path, body, { signal }),
  del: <T>(path: string, params?: TransportParams, signal?: AbortSignal) =>
    redashApi.delete<T>(path, { params, signal }),
}
