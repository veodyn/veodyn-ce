import { describe, expect, it } from 'vitest'
import { ApiError } from '@/services/api-client'
import { removalCopy } from '@/lib/removal'
import {
  ADMIN_SESSION,
  archiveDashboard,
  archiveQuery,
  fork,
  OWNER_SESSION,
  rawDashboard,
  rawQuery,
  readsOf,
  sessionOf,
  SOURCES,
  STAMP,
  STRANGER,
  STRANGER_SESSION,
} from './operation-fixtures'
import { ACCOUNT_UNREADABLE, NOT_ARCHIVED, onlyOwnerMay, resolveOperation } from './operations'

const signal = new AbortController().signal

describe('resolveOperation: fork', () => {
  it('checks a readable query the user may fork and names the copy', async () => {
    const transport = readsOf({ session: STRANGER_SESSION, 'queries/7': rawQuery(), data_sources: SOURCES })
    const result = await resolveOperation(fork(), transport, signal)
    expect(result).toMatchObject({
      kind: 'operation_check',
      ok: true,
      op: 'fork',
      target: { kind: 'query', id: 7, name: 'Weekly revenue' },
      params: { copyName: 'Copy of (#7) Weekly revenue' },
      destructive: false,
      problems: [],
    })
  })

  it('refuses without the edit_query permission', async () => {
    const transport = readsOf({ session: sessionOf(STRANGER, []), 'queries/7': rawQuery(), data_sources: SOURCES })
    const result = await resolveOperation(fork(), transport, signal)
    expect(result).toMatchObject({ ok: true, problems: [expect.stringContaining('edit_query')] })
  })

  it('refuses a data source that is view-only for the user, or not theirs at all', async () => {
    const viewOnly = readsOf({
      session: STRANGER_SESSION,
      'queries/7': rawQuery(),
      data_sources: [{ ...SOURCES[0], view_only: true }],
    })
    const missing = readsOf({ session: STRANGER_SESSION, 'queries/7': rawQuery(), data_sources: [] })
    expect(await resolveOperation(fork(), viewOnly, signal)).toMatchObject({
      problems: [expect.stringContaining('view-only')],
    })
    expect(await resolveOperation(fork(), missing, signal)).toMatchObject({
      problems: [expect.stringContaining('data source')],
    })
  })

  it('reports an unreadable query as not available', async () => {
    const transport = readsOf({ session: OWNER_SESSION, 'queries/7': new ApiError(403, 'no') })
    expect(await resolveOperation(fork(), transport, signal)).toMatchObject({ kind: 'operation_check', ok: false })
  })
})

describe('resolveOperation: archive and restore', () => {
  it('lets the owner archive a query, destructive, with the snapshot and the UI confirm copy', async () => {
    const transport = readsOf({ session: OWNER_SESSION, 'queries/7': rawQuery() })
    const result = await resolveOperation(archiveQuery(), transport, signal)
    expect(result).toMatchObject({
      ok: true,
      op: 'archive',
      target: { kind: 'query', id: 7, name: 'Weekly revenue' },
      destructive: true,
      snapshot: { updatedAt: STAMP },
      params: { consequence: removalCopy('query', 'Weekly revenue').description },
      problems: [],
    })
  })

  it('refuses a non-owner without admin an archive proposal for a query or a dashboard', async () => {
    const query = await resolveOperation(
      archiveQuery(),
      readsOf({ session: STRANGER_SESSION, 'queries/7': rawQuery() }),
      signal
    )
    const dashboard = await resolveOperation(
      archiveDashboard(),
      readsOf({ session: STRANGER_SESSION, 'dashboards/3': rawDashboard() }),
      signal
    )
    expect(query).toMatchObject({ problems: [onlyOwnerMay('query', 'archive')] })
    expect(dashboard).toMatchObject({ problems: [onlyOwnerMay('dashboard', 'archive')] })
  })

  it('lets an admin archive what they do not own', async () => {
    const result = await resolveOperation(
      archiveDashboard(),
      readsOf({ session: ADMIN_SESSION, 'dashboards/3': rawDashboard() }),
      signal
    )
    expect(result).toMatchObject({ ok: true, op: 'archive', destructive: true, problems: [] })
  })

  it('refuses the archive when the account cannot be read, rather than letting it through', async () => {
    const result = await resolveOperation(
      archiveQuery(),
      readsOf({ session: new ApiError(500, 'down'), 'queries/7': rawQuery() }),
      signal
    )
    expect(result).toMatchObject({ kind: 'operation_check', ok: false, error: ACCOUNT_UNREADABLE })
  })

  it('says a dashboard archive stops its public link and restoring does not bring it back', async () => {
    const result = await resolveOperation(
      archiveDashboard(),
      readsOf({ session: OWNER_SESSION, 'dashboards/3': rawDashboard() }),
      signal
    )
    const consequence = (result as unknown as { params: { consequence: string } }).params.consequence
    expect(consequence).toContain(removalCopy('dashboard', 'Ops').description)
    expect(consequence).toContain('does not bring the link back')
  })

  it('restores an archived query for an editor who is not the owner, not destructive', async () => {
    const transport = readsOf({
      session: STRANGER_SESSION,
      'queries/7': rawQuery({ is_archived: true, can_edit: true }),
    })
    expect(await resolveOperation(archiveQuery(true), transport, signal)).toMatchObject({
      ok: true,
      op: 'restore',
      destructive: false,
      snapshot: { updatedAt: STAMP },
      problems: [],
    })
  })

  it('refuses to restore what is not archived, or without edit rights', async () => {
    const live = readsOf({ session: OWNER_SESSION, 'dashboards/3': rawDashboard() })
    const locked = readsOf({
      session: STRANGER_SESSION,
      'dashboards/3': rawDashboard({ is_archived: true, can_edit: false }),
    })
    expect(await resolveOperation(archiveDashboard(true), live, signal)).toMatchObject({
      problems: [NOT_ARCHIVED.dashboard],
    })
    expect(await resolveOperation(archiveDashboard(true), locked, signal)).toMatchObject({
      problems: [expect.stringContaining('edit')],
    })
  })

  it('refuses to archive what is already archived', async () => {
    const transport = readsOf({ session: OWNER_SESSION, 'queries/7': rawQuery({ is_archived: true }) })
    expect(await resolveOperation(archiveQuery(), transport, signal)).toMatchObject({
      problems: [expect.stringContaining('already archived')],
    })
  })
})
