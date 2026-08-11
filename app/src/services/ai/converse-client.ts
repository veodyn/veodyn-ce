import { AppError, ErrorIds, isAppError } from '@/lib/errorIds'
import type { ConverseRequest, ConverseResponse } from '@/types/ai-create'

interface RequestOptions {
  signal?: AbortSignal
}

// An abort is the caller's own decision (the modal closed, a turn superseded),
// so it propagates untouched. Everything else becomes one classified failure:
// the browser never learns the provider endpoint or its body.
function wrapAiError(error: unknown): Error {
  if (isAppError(error)) return error
  if (error instanceof Error && error.name === 'AbortError') return error
  return new AppError(ErrorIds.AI_REQUEST_FAILED, 'AI request failed', {
    cause: error instanceof Error ? error.message : String(error),
  })
}

/**
 * One turn of a Create-with-AI conversation. The whole transcript goes up each
 * time (the endpoint is stateless, spec section 4.1) and no grounding does: the
 * service assembles the catalog and the query list itself.
 */
export async function converse(
  request: ConverseRequest,
  options: RequestOptions = {}
): Promise<ConverseResponse> {
  try {
    const response = await fetch('/api/ai/converse', {
      method: 'POST',
      credentials: 'include',
      signal: options.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    })
    if (!response.ok) {
      throw new AppError(
        ErrorIds.AI_REQUEST_FAILED,
        `AI converse request failed (${response.status})`,
        { status: response.status }
      )
    }
    return (await response.json()) as ConverseResponse
  } catch (error) {
    throw wrapAiError(error)
  }
}
