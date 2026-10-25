import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DraftView } from '@/lib/chat/thread-model'
import type { ChatPromotion } from '@/lib/chat/wire'
import { querySync } from '@/test/query-sync'
import { resolveDraftChart } from './resolve-draft-chart'

const mocks = vi.hoisted(() => ({
  storedGet: vi.fn(),
  recordPromotion: vi.fn(),
  patchPromotion: vi.fn(),
  writeChart: vi.fn(),
}))

vi.mock('@/services/redash/queries', () => ({ get: mocks.storedGet }))
vi.mock('@/services/ai/chat-client', () => ({
  recordPromotion: mocks.recordPromotion,
  patchPromotion: mocks.patchPromotion,
}))
vi.mock('./promote-dashboard-chart', () => ({ VISUALIZATION_STEP: 1, writeChart: mocks.writeChart }))

const PAYLOAD = { name: 'Trips', description: '', sql: 'SELECT 1', dataSourceId: 5, vizChoiceId: 'chart-bar', vizOptions: {} }
const PENDING: ChatPromotion = {
  id: 'p1',
  targetType: 'query',
  targetId: null,
  promotedVersion: 1,
  targetVersionAtPromote: null,
  status: 'pending',
  receipts: [],
  createdAt: 'x',
  updatedAt: 'x',
}
const QUERY_DRAFT: DraftView = { id: 'q1', versions: [{ version: 1, payload: PAYLOAD }], promotions: [] }
const DONE_PATCH = { status: 'done' as const, targetId: '44', receipts: [{ step: 0, outcome: 'done' as const, targetId: '44' }] }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.storedGet.mockResolvedValue({ id: 44, updated_at: 'x', visualizations: [{ id: 7, type: 'CHART' }] })
  mocks.recordPromotion.mockResolvedValue(PENDING)
  mocks.patchPromotion.mockImplementation(async (_draft: string, _id: string, patch: object) => ({ ...PENDING, ...patch }))
})

describe('resolveDraftChart and a record the thread holds', () => {
  it('reads a held query draft as the saved query and writes nothing', async () => {
    const write = vi.fn()
    const sync = querySync({ q1: { promotion: { ...PENDING, ...DONE_PATCH }, patch: DONE_PATCH } })
    const resolved = await resolveDraftChart(write, QUERY_DRAFT, vi.fn(), sync)
    expect(resolved).toEqual({ queryId: 44, visualizationId: 7, visualizationType: 'CHART' })
    expect(write).not.toHaveBeenCalled()
    expect(mocks.recordPromotion).not.toHaveBeenCalled()
  })

  it('holds the record of a query it wrote when that record did not save', async () => {
    const write = vi.fn().mockResolvedValue({ queryId: 44, visualizationId: 7 })
    mocks.patchPromotion.mockRejectedValueOnce(new Error('sidecar down'))
    const onQueryPromoted = vi.fn()
    const sync = querySync()
    const resolved = await resolveDraftChart(write, QUERY_DRAFT, onQueryPromoted, sync)
    expect(resolved).toEqual(expect.objectContaining({ queryId: 44, visualizationId: 7 }))
    expect(onQueryPromoted).not.toHaveBeenCalled()
    expect(sync.hold).toHaveBeenCalledWith('q1', {
      promotion: expect.objectContaining({ id: 'p1', status: 'done', targetId: '44' }),
      patch: expect.objectContaining({ status: 'done', targetId: '44' }),
    })
  })

  it('a held partial record retries the chart and records the whole held record', async () => {
    mocks.writeChart.mockResolvedValue(9)
    const patch = {
      status: 'partial' as const,
      targetId: '44',
      receipts: [
        { step: 0, outcome: 'done' as const, targetId: '44' },
        { step: 1, outcome: 'failed' as const, error: 'viz refused' },
      ],
    }
    const onQueryPromoted = vi.fn()
    const sync = querySync({ q1: { promotion: { ...PENDING, ...patch }, patch } })
    const resolved = await resolveDraftChart(vi.fn(), QUERY_DRAFT, onQueryPromoted, sync)
    expect(resolved).toEqual(expect.objectContaining({ queryId: 44, visualizationId: 9 }))
    expect(mocks.patchPromotion).toHaveBeenCalledWith('q1', 'p1', {
      status: 'done',
      targetId: '44',
      receipts: [
        { step: 0, outcome: 'done', targetId: '44' },
        { step: 1, outcome: 'done', targetId: '9' },
      ],
    })
    expect(onQueryPromoted).toHaveBeenCalledWith('q1', expect.objectContaining({ id: 'p1', status: 'done' }))
  })
})
