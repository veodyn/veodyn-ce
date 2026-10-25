import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/services/api-client'
import type { RedashQuery } from '@/services/redash/types'
import type { ChatToolRequestOf } from './frames'
import type { QueryChanges, QueryEditPayload } from './query-changes'
import { applyQueryEdit, CANNOT_EDIT, diffQuery, resolveQueryEdit, type EditDraft } from './query-edit'
import type { RedashTransport } from './transport'

const chat = vi.hoisted(() => ({ recordPromotion: vi.fn(), patchPromotion: vi.fn() }))
vi.mock('@/services/ai/chat-client', () => chat)

const signal = new AbortController().signal
const UPDATED = '2026-10-24T10:00:00.123Z'
const SAVED = '2026-10-24T10:05:00.456Z'

function raw(overrides: Record<string, unknown> = {}): RedashQuery {
  return {
    id: 5,
    name: 'Trips',
    description: 'Daily trips',
    query: 'select 1',
    data_source_id: 2,
    is_archived: false,
    is_draft: false,
    tags: ['ops'],
    schedule: null,
    options: { apply_auto_limit: true, parameters: [] },
    updated_at: UPDATED,
    visualizations: [],
    can_edit: true,
    ...overrides,
  } as unknown as RedashQuery
}

interface Routes {
  query?: RedashQuery
  sources?: Record<number, { syntax?: string } | Error>
  formatted?: string
  save?: Error | RedashQuery
}

function transportFor(routes: Routes = {}) {
  const get = vi.fn(async (path: string) => {
    if (path === 'queries/5') return routes.query ?? raw()
    const source = routes.sources?.[Number(path.split('/')[1])]
    if (source instanceof Error) throw source
    if (path.startsWith('data_sources/')) return source ?? { syntax: 'sql' }
    throw new Error(`unexpected ${path}`)
  })
  const post = vi.fn(async (...args: unknown[]) => {
    if (args[0] === 'queries/format') return { query: routes.formatted ?? 'formatted' }
    if (routes.save instanceof Error) throw routes.save
    return routes.save ?? raw({ updated_at: SAVED })
  })
  return { get, post, del: vi.fn() } as unknown as RedashTransport & { get: typeof get; post: typeof post }
}

function request(
  changes: ChatToolRequestOf<'update_query'>['args']['changes'],
  format?: boolean
): ChatToolRequestOf<'update_query'> {
  return { callId: '1-1', tool: 'update_query', args: { queryId: 5, changes, format } }
}

describe('resolveQueryEdit', () => {
  it('refuses when can_edit is false', async () => {
    const result = await resolveQueryEdit(request({ name: 'x' }), transportFor({ query: raw({ can_edit: false }) }), signal)
    expect(result).toEqual({ kind: 'query_edit', ok: false, error: CANNOT_EDIT })
    expect(CANNOT_EDIT).toBe('You cannot edit this query: only its owner, an admin or someone it is shared with can.')
  })

  it('refuses to edit a query whose data source was deleted', async () => {
    const result = await resolveQueryEdit(request({ name: 'x' }), transportFor({ query: raw({ data_source_id: null }) }), signal)
    expect(result).toEqual({
      kind: 'query_edit',
      ok: false,
      error: 'This query has no data source; it cannot be opened or edited from chat.',
    })
  })

  it('refuses to edit a query with a tag longer than chat can carry', async () => {
    const result = await resolveQueryEdit(request({ name: 'x' }), transportFor({ query: raw({ tags: ['t'.repeat(65)] }) }), signal)
    expect(result).toEqual({
      kind: 'query_edit',
      ok: false,
      error: 'This query has a tag longer than chat can carry; open it on the query page.',
    })
  })

  it('refuses a tags change on a query with more tags than chat can carry, but still edits its name', async () => {
    const tags = Array.from({ length: 25 }, (_, i) => `tag${i}`)
    const query = raw({ tags })
    const refused = await resolveQueryEdit(request({ tags: ['only'] }), transportFor({ query }), signal)
    expect(refused).toEqual({
      kind: 'query_edit',
      ok: false,
      error: 'This query has more tags than chat can edit safely; change its tags on the query page.',
    })
    const renamed = await resolveQueryEdit(request({ name: 'Renamed' }), transportFor({ query }), signal)
    expect(renamed).toMatchObject({ ok: true, changes: { name: 'Renamed' } })
    expect(renamed.kind === 'query_edit' && Object.keys(renamed.changes ?? {})).toEqual(['name'])
  })

  it('returns only changed fields', async () => {
    const result = await resolveQueryEdit(request({ name: 'Trips', sql: 'select 2' }), transportFor(), signal)
    expect(result).toMatchObject({
      kind: 'query_edit',
      ok: true,
      queryId: 5,
      changes: { sql: 'select 2' },
      snapshot: { id: 5, sql: 'select 1', updatedAt: UPDATED, dataSourceId: 2, isDraft: false },
    })
    expect(result.kind === 'query_edit' && Object.keys(result.changes ?? {})).toEqual(['sql'])
  })

  it('formats sql through queries/format when format is true and the source syntax is sql', async () => {
    const transport = transportFor({ formatted: 'SELECT\n  2' })
    const result = await resolveQueryEdit(request({ sql: 'select 2' }, true), transport, signal)
    expect(transport.post).toHaveBeenCalledWith('queries/format', { query: 'select 2' }, signal)
    expect(result.kind === 'query_edit' && result.changes).toEqual({ sql: 'SELECT\n  2' })
  })

  it('refuses format on a json source', async () => {
    const transport = transportFor({ sources: { 2: { syntax: 'json' } } })
    const result = await resolveQueryEdit(request({ name: 'x' }, true), transport, signal)
    expect(result).toMatchObject({ ok: false })
    expect(transport.post).not.toHaveBeenCalled()
  })

  it('refuses a dataSourceId whose syntax differs from the SQL', async () => {
    const transport = transportFor({ sources: { 2: { syntax: 'sql' }, 9: { syntax: 'json' } } })
    const result = await resolveQueryEdit(request({ dataSourceId: 9 }), transport, signal)
    expect(result).toMatchObject({ kind: 'query_edit', ok: false })
  })

  it('accepts a dataSourceId with the same syntax', async () => {
    const transport = transportFor({ sources: { 2: { syntax: 'sql' }, 9: { syntax: 'sql' } } })
    const result = await resolveQueryEdit(request({ dataSourceId: 9 }), transport, signal)
    expect(result).toMatchObject({ ok: true, changes: { dataSourceId: 9 } })
  })

  it('refuses isDraft when the instance profile lacks query_drafts', async () => {
    const off = await resolveQueryEdit(request({ isDraft: true }), transportFor(), signal)
    expect(off).toMatchObject({ ok: false })
    const on = await resolveQueryEdit(request({ isDraft: true }), transportFor(), signal, { queryDrafts: true })
    expect(on).toMatchObject({ ok: true, changes: { isDraft: true } })
  })

  it('reports a missing query', async () => {
    const transport = { get: vi.fn().mockRejectedValue(new ApiError(404, 'gone')) } as unknown as RedashTransport
    expect(await resolveQueryEdit(request({ name: 'x' }), transport, signal)).toEqual({
      kind: 'query_edit',
      ok: false,
      error: 'No query 5',
    })
  })
})

describe('diffQuery', () => {
  const snapshot = {
    id: 5,
    name: 'Trips',
    description: null,
    sql: 'select 1',
    dataSourceId: 2,
    parameters: [{ name: 'a', type: 'text' }],
    tags: ['ops'],
    schedule: null,
    isDraft: false,
    updatedAt: UPDATED,
  }

  it('treats an empty description as the same as none, and key order as irrelevant', () => {
    const changes: QueryChanges = { description: '', parameters: [{ type: 'text', name: 'a' }], schedule: null }
    expect(diffQuery(snapshot, changes)).toEqual({})
  })

  it('keeps a schedule clear only when there was a schedule', () => {
    const scheduled = { ...snapshot, schedule: { interval: 3600, time: null, dayOfWeek: null, until: null } }
    expect(diffQuery(scheduled, { schedule: null })).toEqual({ schedule: null })
  })
})

describe('applyQueryEdit', () => {
  const snapshot = {
    id: 5,
    name: 'Trips',
    description: 'Daily trips',
    sql: 'select 1',
    dataSourceId: 2,
    parameters: [],
    tags: ['ops'],
    schedule: null,
    isDraft: false,
    updatedAt: UPDATED,
  }

  function draftFor(changes: QueryChanges): EditDraft {
    const payload: QueryEditPayload = { queryId: 5, snapshot, changes }
    return { id: 'd1', versions: [{ version: 1, payload }], promotions: [] }
  }

  const pending = { id: 'p1', status: 'pending', targetId: '5', receipts: [] }

  beforeEach(() => {
    vi.clearAllMocks()
    chat.recordPromotion.mockResolvedValue(pending)
    chat.patchPromotion.mockImplementation(async (_d: string, _p: string, patch: object) => ({ ...pending, ...patch }))
  })

  it('sends expected_updated_at equal to the snapshot updatedAt and only changed fields', async () => {
    const transport = transportFor()
    await applyQueryEdit(draftFor({ sql: 'select 2', name: 'Renamed' }), 1, transport, { overwrite: false })
    expect(transport.post).toHaveBeenCalledWith('queries/5', {
      query: 'select 2',
      name: 'Renamed',
      expected_updated_at: UPDATED,
    })
  })

  it('sends all four schedule keys', async () => {
    const transport = transportFor()
    await applyQueryEdit(draftFor({ schedule: { interval: 86400, time: '06:30' } }), 1, transport, { overwrite: false })
    expect(transport.post.mock.calls[0][1]).toMatchObject({
      schedule: { interval: 86400, time: '06:30', day_of_week: null, until: null },
    })
  })

  it('sends a zero-interval schedule as null, never as an immediately runnable schedule', async () => {
    const transport = transportFor()
    await applyQueryEdit(draftFor({ schedule: { interval: 0 } }), 1, transport, { overwrite: false })
    expect(transport.post.mock.calls[0][1]).toMatchObject({ schedule: null })
  })

  it('sends a cleared schedule as null', async () => {
    const transport = transportFor()
    await applyQueryEdit(draftFor({ schedule: null }), 1, transport, { overwrite: false })
    expect(transport.post.mock.calls[0][1]).toMatchObject({ schedule: null })
  })

  it('returns conflict on 409, and overwrite resends without expected_updated_at', async () => {
    const stale = transportFor({ save: new ApiError(409, 'changed') })
    expect(await applyQueryEdit(draftFor({ name: 'x' }), 1, stale, { overwrite: false })).toEqual({ status: 'conflict' })

    const transport = transportFor()
    const outcome = await applyQueryEdit(draftFor({ name: 'x' }), 1, transport, { overwrite: true })
    expect(outcome.status).toBe('done')
    expect(transport.post.mock.calls[0][1]).toEqual({ name: 'x' })
  })

  it('creates a pending promotion first and patches it done with a receipt carrying the new updatedAt', async () => {
    const order: string[] = []
    chat.recordPromotion.mockImplementation(async () => {
      order.push('record')
      return pending
    })
    const transport = transportFor()
    transport.post.mockImplementation(async () => {
      order.push('write')
      return raw({ updated_at: SAVED })
    })
    chat.patchPromotion.mockImplementation(async (_d: string, _p: string, patch: object) => {
      order.push('patch')
      return { ...pending, ...patch }
    })
    const outcome = await applyQueryEdit(draftFor({ name: 'x' }), 1, transport, { overwrite: false })
    expect(order).toEqual(['record', 'write', 'patch'])
    expect(chat.recordPromotion).toHaveBeenCalledWith('d1', {
      version: 1,
      targetType: 'query',
      targetId: '5',
      status: 'pending',
    })
    expect(chat.patchPromotion).toHaveBeenCalledWith('d1', 'p1', {
      status: 'done',
      targetId: '5',
      receipts: [{ step: 0, outcome: 'done', targetId: '5', updatedAt: SAVED }],
    })
    expect(outcome).toMatchObject({ status: 'done', promotion: { status: 'done' } })
  })

  it('reports an unsynced outcome when node saved but the promotion record did not', async () => {
    chat.patchPromotion.mockRejectedValue(new Error('sidecar down'))
    const outcome = await applyQueryEdit(draftFor({ name: 'x' }), 1, transportFor(), { overwrite: false })
    expect(outcome).toEqual({
      status: 'unsynced',
      promotion: expect.objectContaining({ id: 'p1', status: 'done', targetId: '5' }),
      patch: {
        status: 'done',
        targetId: '5',
        receipts: [{ step: 0, outcome: 'done', targetId: '5', updatedAt: SAVED }],
      },
    })
  })

  it('patches failed with the error when node refuses', async () => {
    const transport = transportFor({ save: new ApiError(403, 'Forbidden here') })
    const outcome = await applyQueryEdit(draftFor({ name: 'x' }), 1, transport, { overwrite: false })
    expect(outcome).toEqual({ status: 'failed', error: 'Forbidden here' })
    expect(chat.patchPromotion).toHaveBeenCalledWith('d1', 'p1', {
      status: 'failed',
      receipts: [{ step: 0, outcome: 'failed', error: 'Forbidden here' }],
    })
  })

  it('writes nothing when the pending promotion cannot be recorded', async () => {
    chat.recordPromotion.mockRejectedValue(new Error('offline'))
    const transport = transportFor()
    const outcome = await applyQueryEdit(draftFor({ name: 'x' }), 1, transport, { overwrite: false })
    expect(outcome.status).toBe('failed')
    expect(transport.post).not.toHaveBeenCalled()
  })

  it('converts parameters to node definitions, keeping native keys the saved definition had', async () => {
    const current = raw({
      options: {
        apply_auto_limit: true,
        parameters: [{ name: 'day', type: 'enum', parentQueryId: 9, multiValuesOptions: { prefix: '', suffix: '', separator: ',' } }],
      },
    })
    const transport = transportFor({ query: current })
    await applyQueryEdit(
      draftFor({ parameters: [{ name: 'day', type: 'enum', enumOptions: 'a\nb', multi: true, quote: 'single' }] }),
      1,
      transport,
      { overwrite: false }
    )
    expect(transport.post.mock.calls[0][1]).toEqual({
      options: {
        apply_auto_limit: true,
        parameters: [
          {
            name: 'day',
            type: 'enum',
            enumOptions: 'a\nb',
            parentQueryId: 9,
            multiValuesOptions: { prefix: "'", suffix: "'", separator: ',' },
          },
        ],
      },
      expected_updated_at: UPDATED,
    })
  })
})
