import { AppError, ErrorIds, isAppError } from '@/lib/errorIds'
import type { GenerateSqlRequest, GenerateSqlResponse } from '@/types/ai'

function wrapAiError(error: unknown): Error {
  if (isAppError(error)) return error
  if (error instanceof Error && error.name === 'AbortError') return error
  return new AppError(ErrorIds.AI_REQUEST_FAILED, 'AI request failed', {
    cause: error instanceof Error ? error.message : String(error),
  })
}

export async function generateSql(
  request: GenerateSqlRequest,
  options: { signal?: AbortSignal } = {}
): Promise<GenerateSqlResponse> {
  try {
    const response = await fetch('/api/ai/generate-sql', {
      method: 'POST',
      credentials: 'include',
      signal: options.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    })
    if (!response.ok) {
      throw new AppError(
        ErrorIds.AI_REQUEST_FAILED,
        `AI generate SQL request failed (${response.status})`,
        { status: response.status }
      )
    }
    return (await response.json()) as GenerateSqlResponse
  } catch (error) {
    throw wrapAiError(error)
  }
}
