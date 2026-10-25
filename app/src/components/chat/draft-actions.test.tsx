import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DraftView } from '@/lib/chat/thread-model'
import { ApiError } from '@/services/api-client'
import { querySync } from '@/test/query-sync'
import { renderWithProviders } from '@/test/utils'
import { CONFLICT_MESSAGE, DraftActions } from './draft-actions'
import { QUERY_GONE_MESSAGE } from '@/hooks/use-promote-draft'

const mocks = vi.hoisted(() => ({
  write: vi.fn(),
  storedGet: vi.fn(),
  recordPromotion: vi.fn(),
  patchPromotion: vi.fn(),
  nodeGet: vi.fn(),
  nodePost: vi.fn(),
  updateVisualization: vi.fn(),
  createVisualization: vi.fn(),
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
  useUpdateVisualization: () => ({ mutateAsync: mocks.updateVisualization }),
  useCreateVisualization: () => ({ mutateAsync: mocks.createVisualization }),
}))

const STAMP = '2026-10-24T10:00:00.123Z'
const NEWER = '2026-10-24T10:30:00.789Z'
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

function draft(overrides: Partial<DraftView> = {}): DraftView {
  return { id: 'd1', versions: [{ version: 1, payload: PAYLOAD }], promotions: [], ...overrides }
}

function revised(promotion: DraftView["promotions"][number] = PROMOTION): DraftView {
  return draft({
    versions: [
      { version: 1, payload: PAYLOAD },
      { version: 2, payload: { ...PAYLOAD, sql: 'SELECT max(speed) FROM t', name: 'Top speed' } },
    ],
    promotions: [promotion],
  })
}

function savedQuery(updatedAt = STAMP) {
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
    updated_at: updatedAt,
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
  mocks.nodePost.mockResolvedValue(savedQuery(NEWER))
  mocks.updateVisualization.mockResolvedValue(undefined)
})

describe('DraftActions: Save', () => {
  it('records a pending promotion, writes with idempotency keys, then patches it done with receipts', async () => {
    const onPromoted = vi.fn()
    renderWithProviders(<DraftActions querySync={querySync()} draft={draft()} onPromoted={onPromoted} />)
    await userEvent.click(screen.getByRole('button', { name: 'Save as query' }))
    await waitFor(() => expect(onPromoted).toHaveBeenCalled())
    expect(mocks.recordPromotion).toHaveBeenCalledWith('d1', { version: 1, targetType: 'query', status: 'pending' })
    expect(mocks.write).toHaveBeenCalledWith(PAYLOAD, PAYLOAD.dataSourceId, {
      idempotencyKeys: { query: 'd1:1:0', visualization: 'd1:1:1' },
      onCreated: expect.any(Function),
    })
    expect(mocks.patchPromotion).toHaveBeenCalledWith('d1', 'pending', {
      status: 'done',
      targetId: '44',
      receipts: [
        { step: 0, outcome: 'done', targetId: '44', updatedAt: STAMP },
        { step: 1, outcome: 'done', targetId: '9' },
      ],
    })
    expect(onPromoted).toHaveBeenCalledWith('d1', expect.objectContaining({ status: 'done', targetId: '44' }))
  })

  it('Save twice sends the same idempotency keys', async () => {
    renderWithProviders(<DraftActions querySync={querySync()} draft={draft()} onPromoted={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Save as query' }))
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1))
    await userEvent.click(screen.getByRole('button', { name: 'Save as query' }))
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(2))
    expect(mocks.write.mock.calls[1][2].idempotencyKeys).toEqual(mocks.write.mock.calls[0][2].idempotencyKeys)
  })

  it('shows a failed save and patches the promotion failed', async () => {
    mocks.write.mockRejectedValue(new Error('permission denied'))
    renderWithProviders(<DraftActions querySync={querySync()} draft={draft()} onPromoted={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Save as query' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('permission denied')
    expect(mocks.patchPromotion).toHaveBeenCalledWith('d1', 'pending', {
      status: 'failed',
      receipts: [{ step: 0, outcome: 'failed', error: 'permission denied' }],
    })
  })

  it('records a partial promotion with the created query when the visualization write fails', async () => {
    mocks.write.mockImplementation(async (_proposal: unknown, _source: number, options: { onCreated: (id: number) => void }) => {
      options.onCreated(44)
      throw new Error('viz refused')
    })
    renderWithProviders(<DraftActions querySync={querySync()} draft={draft()} onPromoted={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Save as query' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('viz refused')
    expect(mocks.patchPromotion).toHaveBeenCalledWith('d1', 'pending', {
      status: 'partial',
      targetId: '44',
      receipts: [
        { step: 0, outcome: 'done', targetId: '44' },
        { step: 1, outcome: 'failed', error: 'viz refused' },
      ],
    })
  })

  it('shows a saved draft as a link', () => {
    renderWithProviders(<DraftActions querySync={querySync()} draft={draft({ promotions: [PROMOTION] })} onPromoted={vi.fn()} />)
    expect(screen.getByRole('link', { name: 'Saved as query 44 · v1' })).toHaveAttribute('href', '/queries/44')
    expect(screen.queryByRole('button', { name: 'Save as query' })).not.toBeInTheDocument()
  })

  it('still offers Save when the only promotion is pending', () => {
    renderWithProviders(<DraftActions querySync={querySync()} draft={draft({ promotions: [PENDING] })} onPromoted={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Save as query' })).toBeInTheDocument()
  })
})

describe('DraftActions: Update saved query', () => {
  it('sends expected_updated_at from the receipt and only the changed fields', async () => {
    const onPromoted = vi.fn()
    renderWithProviders(<DraftActions querySync={querySync()} draft={revised()} onPromoted={onPromoted} />)
    await userEvent.click(screen.getByRole('button', { name: 'Update saved query' }))
    await waitFor(() => expect(onPromoted).toHaveBeenCalled())
    expect(mocks.nodePost).toHaveBeenCalledWith('queries/44', {
      name: 'Top speed',
      query: 'SELECT max(speed) FROM t',
      expected_updated_at: STAMP,
    })
    expect(mocks.updateVisualization).toHaveBeenCalledWith(expect.objectContaining({ queryId: 44, vizId: 7 }))
    expect(mocks.recordPromotion).toHaveBeenCalledWith('d1', expect.objectContaining({ version: 2, status: 'pending' }))
  })

  it('asks before overwriting when node answers 409, and Overwrite resends without the precondition', async () => {
    mocks.nodePost.mockRejectedValueOnce(new ApiError(409, 'changed'))
    renderWithProviders(<DraftActions querySync={querySync()} draft={revised()} onPromoted={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Update saved query' }))
    expect(await screen.findByText(CONFLICT_MESSAGE)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Keep their changes' }))
    expect(screen.queryByText(CONFLICT_MESSAGE)).not.toBeInTheDocument()
    expect(mocks.nodePost).toHaveBeenCalledTimes(1)
    mocks.nodePost.mockRejectedValueOnce(new ApiError(409, 'changed'))
    await userEvent.click(screen.getByRole('button', { name: 'Update saved query' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Overwrite' }))
    await waitFor(() => expect(mocks.nodePost).toHaveBeenCalledTimes(3))
    expect(mocks.nodePost.mock.calls[2][1]).toEqual({ name: 'Top speed', query: 'SELECT max(speed) FROM t' })
  })

  it('a legacy promotion without receipts applies with the current updated_at as the precondition', async () => {
    const onPromoted = vi.fn()
    const legacy = { ...PROMOTION, receipts: [], createdAt: '2026-10-24T11:00:00Z' }
    renderWithProviders(<DraftActions querySync={querySync()} draft={revised(legacy)} onPromoted={onPromoted} />)
    await userEvent.click(screen.getByRole('button', { name: 'Update saved query' }))
    await waitFor(() => expect(onPromoted).toHaveBeenCalled())
    expect(mocks.nodePost.mock.calls[0][1]).toEqual({
      name: 'Top speed',
      query: 'SELECT max(speed) FROM t',
      expected_updated_at: STAMP,
    })
  })

  it('a legacy promotion whose query was edited after it shows the conflict state', async () => {
    mocks.nodeGet.mockResolvedValue(savedQuery(NEWER))
    const legacy = { ...PROMOTION, receipts: [], createdAt: '2026-10-24T09:00:00Z' }
    renderWithProviders(<DraftActions querySync={querySync()} draft={revised(legacy)} onPromoted={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Update saved query' }))
    expect(await screen.findByText(CONFLICT_MESSAGE)).toBeInTheDocument()
    expect(mocks.nodePost).not.toHaveBeenCalled()
  })

  it('records a partial promotion when the query updates but its chart cannot', async () => {
    mocks.updateVisualization.mockRejectedValue(new Error('chart refused'))
    const onPromoted = vi.fn()
    renderWithProviders(<DraftActions querySync={querySync()} draft={revised()} onPromoted={onPromoted} />)
    await userEvent.click(screen.getByRole('button', { name: 'Update saved query' }))
    await waitFor(() => expect(mocks.patchPromotion).toHaveBeenCalledTimes(2))
    expect(mocks.patchPromotion).toHaveBeenLastCalledWith('d1', 'pending', {
      status: 'partial',
      receipts: [
        { step: 0, outcome: 'done', targetId: '44', updatedAt: NEWER },
        { step: 1, outcome: 'failed', error: 'chart refused', targetId: '7' },
      ],
    })
    expect(onPromoted).toHaveBeenLastCalledWith('d1', expect.objectContaining({ status: 'partial' }))
  })

  it('offers a chart retry for a partial promotion that redoes only the chart', async () => {
    const partial = {
      ...PROMOTION,
      promotedVersion: 2,
      status: 'partial' as const,
      receipts: [
        { step: 0, outcome: 'done' as const, targetId: '44', updatedAt: NEWER },
        { step: 1, outcome: 'failed' as const, error: 'chart refused' },
      ],
    }
    const onPromoted = vi.fn()
    renderWithProviders(<DraftActions querySync={querySync()} draft={revised(partial)} onPromoted={onPromoted} />)
    expect(screen.queryByRole('button', { name: 'Update saved query' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Retry chart update' }))
    await waitFor(() => expect(onPromoted).toHaveBeenCalled())
    expect(mocks.nodePost).not.toHaveBeenCalled()
    expect(mocks.updateVisualization).toHaveBeenCalledWith(expect.objectContaining({ queryId: 44, vizId: 7 }))
    expect(mocks.patchPromotion).toHaveBeenCalledWith('d1', 'p1', {
      status: 'done',
      receipts: [
        { step: 0, outcome: 'done', targetId: '44', updatedAt: NEWER },
        { step: 1, outcome: 'done', targetId: '7' },
      ],
    })
  })

  it('refreshes the query lists and the query once the update lands', async () => {
    const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries')
    const onPromoted = vi.fn()
    renderWithProviders(<DraftActions querySync={querySync()} draft={revised()} onPromoted={onPromoted} />)
    await userEvent.click(screen.getByRole('button', { name: 'Update saved query' }))
    await waitFor(() => expect(onPromoted).toHaveBeenCalled())
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['queries'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['query', 44] })
    invalidate.mockRestore()
  })

  it('says so when the saved query is gone', async () => {
    mocks.nodeGet.mockRejectedValue(new ApiError(404, 'gone'))
    renderWithProviders(<DraftActions querySync={querySync()} draft={revised()} onPromoted={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Update saved query' }))
    expect(await screen.findByText(QUERY_GONE_MESSAGE)).toBeInTheDocument()
    expect(mocks.nodePost).not.toHaveBeenCalled()
  })
})
