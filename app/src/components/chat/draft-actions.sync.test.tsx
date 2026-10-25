import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DraftView } from '@/lib/chat/thread-model'
import { querySync } from '@/test/query-sync'
import { renderWithProviders } from '@/test/utils'
import { DraftActions } from './draft-actions'

const mocks = vi.hoisted(() => ({
  write: vi.fn(),
  storedGet: vi.fn(),
  recordPromotion: vi.fn(),
  patchPromotion: vi.fn(),
  nodeGet: vi.fn(),
  nodePost: vi.fn(),
}))

vi.mock('@/components/chat/proposal-kit/use-write-proposed-query', () => ({
  useWriteProposedQuery: () => ({ write: mocks.write, isPending: false }),
}))
vi.mock('@/services/redash/queries', () => ({ get: mocks.storedGet }))
vi.mock('@/services/ai/chat-client', () => ({
  recordPromotion: mocks.recordPromotion,
  patchPromotion: mocks.patchPromotion,
}))
vi.mock('@/lib/chat/transport', () => ({
  browserTransport: { get: mocks.nodeGet, post: mocks.nodePost, del: vi.fn() },
}))
vi.mock('@/hooks/use-visualizations', () => ({
  useUpdateVisualization: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined) }),
  useCreateVisualization: () => ({ mutateAsync: vi.fn() }),
}))

const STAMP = '2026-10-24T10:00:00.123Z'
const PAYLOAD = {
  name: 'Average speed',
  description: 'Mean.',
  sql: 'SELECT avg(speed) FROM t',
  dataSourceId: 5,
  datasetTable: 't',
  vizChoiceId: 'chart-bar',
  vizOptions: {},
}
const PROMOTION = {
  id: 'p1',
  targetType: 'query',
  targetId: '44',
  promotedVersion: 1,
  targetVersionAtPromote: null,
  status: 'done' as const,
  receipts: [{ step: 0, outcome: 'done' as const, targetId: '44', updatedAt: STAMP }],
  createdAt: 'x',
  updatedAt: 'x',
}
const PENDING = { ...PROMOTION, id: 'pending', targetId: null, status: 'pending' as const, receipts: [] }

function draft(promotions: DraftView['promotions'] = []): DraftView {
  return { id: 'd1', versions: [{ version: 1, payload: PAYLOAD }], promotions }
}

function revised(): DraftView {
  return {
    ...draft([PROMOTION]),
    versions: [
      { version: 1, payload: PAYLOAD },
      { version: 2, payload: { ...PAYLOAD, sql: 'SELECT max(speed) FROM t', name: 'Top speed' } },
    ],
  }
}

function savedQuery() {
  return {
    id: 44,
    name: 'Average speed',
    description: 'Mean.',
    query: 'SELECT avg(speed) FROM t',
    data_source_id: 5,
    is_archived: false,
    is_draft: false,
    tags: [],
    schedule: null,
    options: { parameters: [] },
    updated_at: STAMP,
    can_edit: true,
    visualizations: [{ id: 7, type: 'CHART', name: 'Chart', options: { legend: true } }],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.write.mockResolvedValue({ queryId: 44, visualizationId: 9 })
  mocks.storedGet.mockResolvedValue({ id: 44, updated_at: STAMP })
  mocks.recordPromotion.mockResolvedValue(PENDING)
  mocks.patchPromotion.mockImplementation(async (_draft: string, _id: string, patch: object) => ({ ...PENDING, ...patch }))
  mocks.nodeGet.mockResolvedValue(savedQuery())
  mocks.nodePost.mockResolvedValue(savedQuery())
})

describe('DraftActions and the thread-held record', () => {
  it('Save whose record did not sync hands the record to the thread instead of recording it', async () => {
    mocks.patchPromotion.mockRejectedValueOnce(new Error('sidecar down'))
    const onPromoted = vi.fn()
    const sync = querySync()
    renderWithProviders(<DraftActions querySync={sync} draft={draft()} onPromoted={onPromoted} />)
    await userEvent.click(screen.getByRole('button', { name: 'Save as query' }))
    await waitFor(() => expect(sync.hold).toHaveBeenCalled())
    expect(sync.hold).toHaveBeenCalledWith('d1', {
      promotion: expect.objectContaining({ id: 'pending', status: 'done', targetId: '44' }),
      patch: mocks.patchPromotion.mock.calls[0][2],
    })
    expect(onPromoted).not.toHaveBeenCalled()
  })

  it('while the thread holds the record, offers only the retry, and retries through the thread', async () => {
    const patch = { status: 'done' as const, targetId: '44', receipts: PROMOTION.receipts }
    const sync = querySync({ d1: { promotion: { ...PENDING, ...patch }, patch } })
    renderWithProviders(<DraftActions querySync={sync} draft={draft()} onPromoted={vi.fn()} />)
    expect(screen.getByText('Saved, but the record of it did not save.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save as query' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(sync.retry).toHaveBeenCalledWith('d1')
    expect(mocks.patchPromotion).not.toHaveBeenCalled()
    expect(mocks.write).not.toHaveBeenCalled()
  })

  it('Update whose record did not sync hands the record to the thread', async () => {
    mocks.patchPromotion.mockRejectedValueOnce(new Error('sidecar down'))
    const onPromoted = vi.fn()
    const sync = querySync()
    renderWithProviders(<DraftActions querySync={sync} draft={revised()} onPromoted={onPromoted} />)
    await userEvent.click(screen.getByRole('button', { name: 'Update saved query' }))
    await waitFor(() => expect(sync.hold).toHaveBeenCalled())
    expect(sync.hold).toHaveBeenCalledWith('d1', {
      promotion: expect.objectContaining({ status: 'done', targetId: '44' }),
      patch: expect.objectContaining({ status: 'done', targetId: '44' }),
    })
    expect(onPromoted).not.toHaveBeenCalled()
    expect(mocks.nodePost).toHaveBeenCalledTimes(1)
  })
})
