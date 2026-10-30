import { abortError } from '@/lib/abortable-delay'

export class ResponseTooLargeError extends Error {
  readonly bytesRead: number
  readonly maxBytes: number
  readonly declaredBytes: number | null

  constructor(bytesRead: number, maxBytes: number, declaredBytes: number | null) {
    super(`The response is larger than ${maxBytes} bytes`)
    this.name = 'ResponseTooLargeError'
    this.bytesRead = bytesRead
    this.maxBytes = maxBytes
    this.declaredBytes = declaredBytes
  }
}

function declaredLength(response: Response): number | null {
  const header = response.headers.get('content-length')
  if (header === null || header.trim() === '') return null
  const value = Number(header)
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined)
}

export async function readCappedJson<T>(response: Response, maxBytes: number, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) {
    await discard(response)
    throw abortError()
  }
  const declared = declaredLength(response)
  if (declared !== null && declared > maxBytes) {
    await discard(response)
    throw new ResponseTooLargeError(0, maxBytes, declared)
  }
  if (!response.body) return (await response.json()) as T
  const reader = response.body.getReader()
  const cancel = () => reader.cancel().catch(() => undefined)
  const onAbort = () => void cancel()
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const decoder = new TextDecoder()
    let text = ''
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (signal?.aborted) {
        await cancel()
        throw abortError()
      }
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await cancel()
        throw new ResponseTooLargeError(total, maxBytes, declared)
      }
      text += decoder.decode(value, { stream: true })
    }
    return JSON.parse(text + decoder.decode()) as T
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}
