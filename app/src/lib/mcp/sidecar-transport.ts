import { USER_TOKEN_HEADER } from '@/lib/chat/relay'
import { createSidecarTransport, type SidecarTransport } from '@/lib/chat/sidecar-transport'
import { env } from '@/lib/env'
import { AppError, ErrorIds } from '@/lib/errorIds'
import type { McpCredential } from './redash-caller'

export function configuredSidecarUrl(): string | null {
  const url = env.KPI_API_URL || env.REPORTS_API_URL
  return url ? url.replace(/\/+$/, '') : null
}

export function mcpSidecarTransport(
  credential: McpCredential,
  subjectToken: string,
  baseUrl: () => string | null = configuredSidecarUrl,
  fetcher?: typeof fetch
): SidecarTransport {
  return createSidecarTransport({
    address: (path) => {
      const base = baseUrl()
      if (!base) throw new AppError(ErrorIds.AI_CHAT_UNAVAILABLE, 'The sidecar URL (KPI_API_URL) is not configured')
      return `${base}/${path.replace(/^\/+/, '')}`
    },
    headers: () => ({
      [USER_TOKEN_HEADER]: subjectToken,
      ...(credential.apiKey
        ? { authorization: `Key ${credential.apiKey}` }
        : credential.session
          ? { cookie: `session=${credential.session}` }
          : {}),
    }),
    fetcher,
  })
}
