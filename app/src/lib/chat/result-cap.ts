import { readQueryError } from '@/lib/query-error'
import { ResponseTooLargeError } from '@/services/capped-body'

const MEBIBYTE = 1024 * 1024

export const CHAT_RESULT_MAX_MEBIBYTES = 8
export const CHAT_RESULT_MAX_BYTES = CHAT_RESULT_MAX_MEBIBYTES * MEBIBYTE
export const RESULT_TOO_LARGE_PREFIX = 'The query result is too large to load'

function bytes(count: number): string {
  return `${count.toLocaleString('en-US')} bytes`
}

export function resultTooLargeMessage(error: ResponseTooLargeError): string {
  const declared = error.declaredBytes === null ? '' : ` (the response declares ${bytes(error.declaredBytes)})`
  return (
    `${RESULT_TOO_LARGE_PREFIX}: reading stopped after ${bytes(error.bytesRead)}${declared}, ` +
    `over the cap of ${bytes(error.maxBytes)}, and none of it was parsed. ` +
    'Narrow the query and run it again: filter the rows, aggregate them, or add a LIMIT. ' +
    'For an MCA resource, pass narrower params.'
  )
}

export function isResultTooLargeMessage(message: string | null | undefined): boolean {
  return message?.startsWith(RESULT_TOO_LARGE_PREFIX) ?? false
}

export function runErrorMessage(error: unknown): string {
  return error instanceof ResponseTooLargeError ? resultTooLargeMessage(error) : readQueryError(error).message
}
