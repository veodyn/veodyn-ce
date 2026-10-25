import { describe, expect, it } from 'vitest'
import type { QueryResultData } from '@/lib/mock-data'
import { draftPreviewOf } from './draft-preview'
import { emptyThread, type RunView } from './thread-model'

const PAYLOAD = {
  name: 'Trips by day',
  description: '',
  sql: 'select day, trips from t',
  dataSourceId: 2,
  vizChoiceId: 'table',
  vizOptions: {},
}

const RUN: RunView = {
  callId: 'c1',
  dataSourceId: 2,
  purpose: 'p',
  sql: PAYLOAD.sql,
  vizChoiceId: 'table',
  status: 'done',
  rowCount: 2,
  durationMs: 5,
  error: null,
}

const DATA = { columns: [{ name: 'day' }, { name: 'trips' }], rows: [] } as unknown as QueryResultData

function threadWithDraft() {
  return { ...emptyThread(), drafts: { d1: { id: 'd1', versions: [{ version: 1, payload: PAYLOAD }], promotions: [] } } }
}

describe('draftPreviewOf', () => {
  it('reads the columns of the run whose SQL is the draft SQL', () => {
    const state = { ...threadWithDraft(), runs: { c1: RUN } }
    expect(draftPreviewOf(state, { c1: DATA }, 'd1')).toEqual({ name: 'Trips by day', columns: ['day', 'trips'] })
  })

  it('ignores a run of the same SQL against another data source', () => {
    const state = { ...threadWithDraft(), runs: { c1: { ...RUN, dataSourceId: 99 } } }
    expect(draftPreviewOf(state, { c1: DATA }, 'd1')).toEqual({ name: 'Trips by day', columns: [] })
  })

  it('knows the name but no columns for a draft that has not been run', () => {
    expect(draftPreviewOf(threadWithDraft(), {}, 'd1')).toEqual({ name: 'Trips by day', columns: [] })
  })

  it('knows nothing of a draft the thread does not hold', () => {
    expect(draftPreviewOf(emptyThread(), {}, 'missing')).toBeNull()
  })
})
