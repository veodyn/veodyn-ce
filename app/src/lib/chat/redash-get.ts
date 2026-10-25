import { redashFetch } from '@/lib/redash-server'

export type ContextGet = <T>(path: string, signal: AbortSignal) => Promise<T | null>

export interface ContextReader {
  get: ContextGet
  key: string
}

export interface Access extends ContextReader {
  signal: AbortSignal
}

export function cookieReader(cookie: string | null): ContextReader {
  return {
    key: cookie ?? '',
    get: async <T>(path: string, signal: AbortSignal) => {
      try {
        const response = await redashFetch(path, { cookie: cookie ?? undefined, signal })
        return response.ok ? ((await response.json()) as T) : null
      } catch {
        return null
      }
    },
  }
}

export async function getJson<T>(path: string, access: Access): Promise<T | null> {
  try {
    return await access.get<T>(path, access.signal)
  } catch {
    return null
  }
}
