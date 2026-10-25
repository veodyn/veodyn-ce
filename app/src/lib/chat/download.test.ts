import { describe, expect, it } from 'vitest'
import { ApiError } from '@/services/api-client'
import type { ChatToolRequestOf } from './frames'
import { NO_EXPORT, NO_RESULT_TO_DOWNLOAD, resolveDownload } from './download'
import { NOT_AVAILABLE } from './library-results'
import { OWNER, OWNER_SESSION, rawQuery, readsOf, sessionOf } from './operation-fixtures'

const signal = new AbortController().signal

function download(format: 'csv' | 'xlsx' = 'csv'): ChatToolRequestOf<'download_result'> {
  return { callId: 'c1', tool: 'download_result', args: { queryId: 7, format } }
}

describe('resolveDownload', () => {
  it('hands the result link of the query and format', async () => {
    const result = await resolveDownload(download('xlsx'), readsOf({ session: OWNER_SESSION, 'queries/7': rawQuery() }), signal)
    expect(result).toEqual({
      kind: 'download',
      ok: true,
      queryId: 7,
      format: 'xlsx',
      href: '/api/node/queries/7/results.xlsx',
    })
  })

  it('refuses a user with no_export_data', async () => {
    const transport = readsOf({ session: sessionOf(OWNER, ['no_export_data']), 'queries/7': rawQuery() })
    expect(await resolveDownload(download(), transport, signal)).toEqual({ kind: 'download', ok: false, error: NO_EXPORT })
  })

  it('refuses a query with no stored result', async () => {
    const transport = readsOf({ session: OWNER_SESSION, 'queries/7': rawQuery({ latest_query_data_id: null }) })
    expect(await resolveDownload(download(), transport, signal)).toEqual({
      kind: 'download',
      ok: false,
      error: NO_RESULT_TO_DOWNLOAD,
    })
  })

  it('refuses a query the user cannot read, and when the account cannot be read', async () => {
    const hidden = readsOf({ session: OWNER_SESSION, 'queries/7': new ApiError(403, 'no') })
    const blind = readsOf({ session: new ApiError(500, 'down'), 'queries/7': rawQuery() })
    expect(await resolveDownload(download(), hidden, signal)).toEqual({ kind: 'download', ok: false, error: NOT_AVAILABLE })
    expect(await resolveDownload(download(), blind, signal)).toMatchObject({ kind: 'download', ok: false })
  })
})
