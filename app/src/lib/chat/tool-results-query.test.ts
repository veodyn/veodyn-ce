import { describe, expect, it } from 'vitest'
import { queryDetailResultSchema, queryEditResultSchema } from './tool-results-query'

const snapshot = {
  id: 5,
  name: 'Trips',
  sql: 'select 1',
  dataSourceId: 1,
  isDraft: false,
  updatedAt: '2026-10-24T09:00:00+00:00',
}

function detail(length: number) {
  return {
    ok: true,
    kind: 'query_detail',
    query: { ...snapshot, description: 'x'.repeat(length), canEdit: true },
  }
}

function edit(length: number) {
  return {
    ok: true,
    kind: 'query_edit',
    queryId: 5,
    snapshot: { ...snapshot, description: 'x'.repeat(length) },
    changes: { name: 'Renamed' },
  }
}

describe('query result schemas', () => {
  it('accepts a description of 4096 characters in a query_detail result', () => {
    expect(queryDetailResultSchema.safeParse(detail(4096)).success).toBe(true)
  })

  it('refuses a description of 4097 characters in a query_detail result', () => {
    expect(queryDetailResultSchema.safeParse(detail(4097)).success).toBe(false)
  })

  it('accepts a description of 4096 characters in a query_edit snapshot', () => {
    expect(queryEditResultSchema.safeParse(edit(4096)).success).toBe(true)
  })

  it('refuses a description of 4097 characters in a query_edit snapshot', () => {
    expect(queryEditResultSchema.safeParse(edit(4097)).success).toBe(false)
  })
})
