import { redashFetch } from '@/lib/redash-server'

export interface Access {
  cookie: string | null
  signal: AbortSignal
}

export async function getJson<T>(path: string, access: Access): Promise<T | null> {
  try {
    const response = await redashFetch(path, { cookie: access.cookie ?? undefined, signal: access.signal })
    return response.ok ? ((await response.json()) as T) : null
  } catch {
    return null
  }
}
