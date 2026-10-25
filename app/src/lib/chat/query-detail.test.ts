import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/services/api-client'
import type { RedashQuery } from '@/services/redash/types'
import type { ChatToolRequestOf } from './frames'
import { runOpenQuery } from './query-detail'
import type { RedashTransport } from './transport'

const request: ChatToolRequestOf<'open_query'> = { callId: '1-1', tool: 'open_query', args: { queryId: 5 } }
const signal = new AbortController().signal

function raw(overrides: Partial<RedashQuery> = {}): RedashQuery {
  return {
    id: 5,
    name: 'Trips',
    description: 'Daily trips',
    query: 'select {{ day }}',
    data_source_id: 2,
    is_archived: false,
    is_draft: true,
    is_favorite: false,
    tags: ['ops'],
    schedule: { interval: 86400, time: '06:30', day_of_week: null, until: null },
    options: {
      parameters: [
        { name: 'day', type: 'enum', title: 'Day', enumOptions: 'a\nb', multiValuesOptions: { prefix: "'", suffix: "'", separator: ',' } },
      ],
    },
    user: { id: 1, name: 'a', email: 'a@x' },
    created_at: '',
    updated_at: '2026-10-24T10:00:00.123Z',
    retrieved_at: null,
    runtime: null,
    latest_query_data_id: null,
    visualizations: [{ id: 30, type: 'TABLE', name: 'Table' }],
    can_edit: true,
    ...overrides,
  } as unknown as RedashQuery
}

function transportReturning(query: RedashQuery | Error): RedashTransport {
  const get = vi.fn(async () => {
    if (query instanceof Error) throw query
    return query
  })
  return { get, post: vi.fn(), del: vi.fn() } as unknown as RedashTransport
}

describe('runOpenQuery', () => {
  it('returns full sql, parameter definitions, schedule, tags, isDraft, updatedAt and canEdit', async () => {
    const transport = transportReturning(raw())
    const result = await runOpenQuery(request, transport, signal)
    expect(transport.get).toHaveBeenCalledWith('queries/5', undefined, signal)
    expect(result).toEqual({
      kind: 'query_detail',
      ok: true,
      query: {
        id: 5,
        name: 'Trips',
        description: 'Daily trips',
        sql: 'select {{ day }}',
        dataSourceId: 2,
        parameters: [{ name: 'day', type: 'enum', title: 'Day', enumOptions: 'a\nb', multi: true, quote: 'single' }],
        tags: ['ops'],
        schedule: { interval: 86400, time: '06:30', dayOfWeek: null, until: null },
        isDraft: true,
        updatedAt: '2026-10-24T10:00:00.123Z',
        canEdit: true,
        visualizations: [{ id: 30, name: 'Table', type: 'TABLE' }],
      },
    })
  })

  it('reports no schedule as null', async () => {
    const result = await runOpenQuery(request, transportReturning(raw({ schedule: null })), signal)
    expect(result.kind === 'query_detail' && result.query?.schedule).toBeNull()
  })

  it('reports a missing query as ok false with "No query <id>"', async () => {
    const result = await runOpenQuery(request, transportReturning(new ApiError(404, 'gone')), signal)
    expect(result).toEqual({ kind: 'query_detail', ok: false, error: 'No query 5' })
  })

  it('treats an archived query as missing', async () => {
    const result = await runOpenQuery(request, transportReturning(raw({ is_archived: true })), signal)
    expect(result).toMatchObject({ ok: false, error: 'No query 5' })
  })

  it('refuses a query whose data source was deleted, so the turn still gets a result', async () => {
    const result = await runOpenQuery(request, transportReturning(raw({ data_source_id: null as never })), signal)
    expect(result).toEqual({
      kind: 'query_detail',
      ok: false,
      error: 'This query has no data source; it cannot be opened or edited from chat.',
    })
  })

  it('refuses a query with a tag longer than chat can carry', async () => {
    const result = await runOpenQuery(request, transportReturning(raw({ tags: ['t'.repeat(65)] })), signal)
    expect(result).toEqual({
      kind: 'query_detail',
      ok: false,
      error: 'This query has a tag longer than chat can carry; open it on the query page.',
    })
  })

  it('refuses a query chat cannot carry whole', async () => {
    const result = await runOpenQuery(request, transportReturning(raw({ query: 'x'.repeat(50_001) })), signal)
    expect(result.ok).toBe(false)
  })
})
