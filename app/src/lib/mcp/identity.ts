import { mintAiToken } from '@/lib/ai-token'
import { env } from '@/lib/env'
import { AppError, ErrorIds } from '@/lib/errorIds'
import { callRedash, hasCredential, McpUnauthorized, type McpCredential } from './redash-caller'

export async function verifyCaller(
  credential: McpCredential,
  signal: AbortSignal
): Promise<{ userId: number } | null> {
  if (!hasCredential(credential)) return null
  try {
    const session = await callRedash<{ user?: { id?: unknown } }>('/api/session', credential, { signal })
    const id = session?.user?.id
    return typeof id === 'number' ? { userId: id } : null
  } catch (error) {
    if (error instanceof McpUnauthorized) return null
    throw error
  }
}

export function mcpSubjectToken(userId: number): string {
  const secret = env.VEODYN_AI__TOKEN_SECRET
  if (!secret) {
    throw new AppError(
      ErrorIds.AI_CHAT_UNAVAILABLE,
      'The AI token secret (VEODYN_AI__TOKEN_SECRET) is not configured'
    )
  }
  return mintAiToken(userId, secret)
}
