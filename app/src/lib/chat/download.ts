import { readQueryError } from '@/lib/query-error'
import type { ChatToolRequestOf } from './frames'
import { NOT_AVAILABLE } from './library-results'
import { readAccount, readObject, type StoredQuery } from './operation-access'
import { ACCOUNT_UNREADABLE } from './operation-copy'
import { downloadHref, type ChatDownloadResult } from './tool-results-operation'
import type { RedashTransport } from './transport'

export const NO_EXPORT = 'Your account may not export data, so chat cannot hand out a download.'
export const NO_RESULT_TO_DOWNLOAD = 'This query has no stored result to download; run it first.'

function refused(error: string): ChatDownloadResult {
  return { kind: 'download', ok: false, error: error.slice(0, 500) }
}

async function resolve(
  request: ChatToolRequestOf<'download_result'>,
  transport: RedashTransport,
  signal: AbortSignal
): Promise<ChatDownloadResult> {
  const { queryId, format } = request.args
  const [account, raw] = await Promise.all([
    readAccount(transport, signal),
    readObject<StoredQuery>(transport, `queries/${queryId}`, signal),
  ])
  if (!account) return refused(ACCOUNT_UNREADABLE)
  if (account.permissions.includes('no_export_data')) return refused(NO_EXPORT)
  if (!raw) return refused(NOT_AVAILABLE)
  if (raw.latest_query_data_id == null) return refused(NO_RESULT_TO_DOWNLOAD)
  return { kind: 'download', ok: true, queryId, format, href: downloadHref(queryId, format) }
}

export async function resolveDownload(
  request: ChatToolRequestOf<'download_result'>,
  transport: RedashTransport,
  signal: AbortSignal
): Promise<ChatDownloadResult> {
  try {
    return await resolve(request, transport, signal)
  } catch (error) {
    if (signal.aborted) throw error
    return refused(readQueryError(error).message)
  }
}
