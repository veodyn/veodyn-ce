import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DraftView } from '@/lib/chat/thread-model'
import { querySync } from '@/test/query-sync'
import { renderWithProviders } from '@/test/utils'
import { DraftActions } from './draft-actions'

const mocks = vi.hoisted(() => ({
  recordPromotion: vi.fn(),
  patchPromotion: vi.fn(),
  nodeGet: vi.fn(),
  nodePost: vi.fn(),
  updateVisualization: vi.fn(),
  createVisualization: vi.fn(),
}))

vi.mock('@/components/chat/proposal-kit/use-write-proposed-query', () => ({
  useWriteProposedQuery: () => ({ write: vi.fn(), isPending: false }),
}))
vi.mock('@/services/redash/queries', () => ({ get: vi.fn() }))
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
const PAYLOAD = {
  name: 'Average speed',
  description: 'Mean.',
  sql: 'SELECT avg(speed) FROM t',
  dataSourceId: 5,
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

function savedQuery(visualizations: unknown[]) {
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
    visualizations,
  }
}

function revised(payload: Record<string, unknown>): DraftView {
  return {
    id: 'd1',
    versions: [
      { version: 1, payload: { ...PAYLOAD, ...payload, vizOptions: {} } },
      { version: 2, payload: { ...PAYLOAD, ...payload, name: 'Top speed' } },
    ],
    promotions: [PROMOTION],
  } as DraftView
}

async function updateWith(draft: DraftView) {
  const onPromoted = vi.fn()
  renderWithProviders(<DraftActions querySync={querySync()} draft={draft} onPromoted={onPromoted} />)
  await userEvent.click(screen.getByRole('button', { name: 'Update saved query' }))
  await waitFor(() => expect(onPromoted).toHaveBeenCalled())
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.recordPromotion.mockResolvedValue(PENDING)
  mocks.patchPromotion.mockImplementation(async (_d: string, _p: string, patch: object) => ({ ...PENDING, ...patch }))
  mocks.nodePost.mockResolvedValue({ ...savedQuery([]), updated_at: '2026-10-24T10:30:00.789Z' })
  mocks.updateVisualization.mockResolvedValue(undefined)
  mocks.createVisualization.mockResolvedValue({ id: 8 })
})

describe('Update saved query with vizOptions', () => {
  it('merges the sanitized options over the existing chart options', async () => {
    mocks.nodeGet.mockResolvedValue(
      savedQuery([{ id: 7, type: 'CHART', name: 'Chart', options: { legend: true } }])
    )
    await updateWith(revised({ vizOptions: { showDataLabels: true, bogus: 1 } }))
    expect(mocks.updateVisualization).toHaveBeenCalledWith(
      expect.objectContaining({
        vizId: 7,
        options: { legend: true, globalSeriesType: 'bar', showDataLabels: true },
      })
    )
  })

  it('creates the chart with the sanitized options when the query has none of that type', async () => {
    mocks.nodeGet.mockResolvedValue(savedQuery([]))
    await updateWith(revised({ vizOptions: { showDataLabels: true, bogus: 1 } }))
    expect(mocks.createVisualization).toHaveBeenCalledWith(
      expect.objectContaining({ options: { globalSeriesType: 'bar', showDataLabels: true } })
    )
  })

  it('writes the sanitized options onto the existing table when the choice is the table', async () => {
    const columns = [{ name: 'day', title: 'Day' }]
    mocks.nodeGet.mockResolvedValue(savedQuery([{ id: 3, type: 'TABLE', name: 'Table', options: {} }]))
    await updateWith(revised({ vizChoiceId: 'table', vizOptions: { columns, bogus: 1 } }))
    expect(mocks.updateVisualization).toHaveBeenCalledWith(expect.objectContaining({ vizId: 3, options: { columns } }))
  })

  it('leaves the table alone when the table choice carries no options', async () => {
    mocks.nodeGet.mockResolvedValue(savedQuery([{ id: 3, type: 'TABLE', name: 'Table', options: {} }]))
    await updateWith(revised({ vizChoiceId: 'table', vizOptions: {} }))
    expect(mocks.updateVisualization).not.toHaveBeenCalled()
  })
})
