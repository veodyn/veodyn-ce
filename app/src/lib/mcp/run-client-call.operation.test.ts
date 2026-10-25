// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { OWNER_SESSION, rawDashboard, rawQuery, readsOf, STRANGER_SESSION } from '@/lib/chat/operation-fixtures'
import { runClientCall } from './run-client-call'

const signal = new AbortController().signal
const FEATURES = { queryDrafts: false }

describe('runClientCall operations', () => {
  it('resolves an archive proposal on the server transport', async () => {
    const transport = readsOf({ session: OWNER_SESSION, 'queries/7': rawQuery() })
    const result = await runClientCall({ tool: 'archive_query', args: { queryId: 7, restore: false } }, transport, signal, FEATURES)
    expect(result).toMatchObject({ kind: 'operation_check', ok: true, op: 'archive', destructive: true, problems: [] })
  })

  it('refuses a non-owner the archive over MCP too', async () => {
    const transport = readsOf({ session: STRANGER_SESSION, 'dashboards/3': rawDashboard() })
    const result = await runClientCall(
      { tool: 'archive_dashboard', args: { dashboardId: 3, restore: false } },
      transport,
      signal,
      FEATURES
    )
    expect(result).toMatchObject({ kind: 'operation_check', problems: [expect.stringContaining('owner')] })
  })

  it('hands a download link and answers unreadable arguments with the tool kind', async () => {
    const transport = readsOf({ session: OWNER_SESSION, 'queries/7': rawQuery() })
    const download = await runClientCall({ tool: 'download_result', args: { queryId: 7, format: 'csv' } }, transport, signal, FEATURES)
    const unreadable = await runClientCall({ tool: 'fork_query', args: { queryId: 'x' } }, transport, signal, FEATURES)
    expect(download).toEqual({ kind: 'download', ok: true, queryId: 7, format: 'csv', href: '/api/node/queries/7/results.csv' })
    expect(unreadable).toMatchObject({ kind: 'operation_check', ok: false, destructive: false })
  })

  it('dispatches every operation tool rather than reporting it unknown', async () => {
    const transport = readsOf({ session: OWNER_SESSION, 'queries/7': rawQuery(), 'dashboards/3': rawDashboard(), data_sources: [] })
    const calls = [
      { tool: 'fork_query', args: { queryId: 7 } },
      { tool: 'set_favorite', args: { kind: 'query', id: 7, favorite: true } },
      { tool: 'share_dashboard', args: { dashboardId: 3, action: 'create', expiresAt: null } },
      { tool: 'share_visualization', args: { queryId: 7, visualizationId: 31, action: 'create', expiresAt: null, refreshSeconds: 60 } },
    ]
    for (const call of calls) {
      expect(await runClientCall(call, transport, signal, FEATURES)).toMatchObject({ kind: 'operation_check' })
    }
  })
})
