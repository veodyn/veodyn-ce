import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DraftView } from '@/lib/chat/thread-model'
import type { ChatPromotion } from '@/lib/chat/wire'
import { writeChart } from './promote-dashboard-chart'

const services = vi.hoisted(() => ({ get: vi.fn(), createVisualization: vi.fn(), updateVisualization: vi.fn() }))

vi.mock('@/services/redash/queries', () => ({ get: services.get }))
vi.mock('@/services/redash/visualizations', () => ({
  createVisualization: services.createVisualization,
  updateVisualization: services.updateVisualization,
}))

const PROPOSAL = {
  version: 2,
  payload: {
    name: 'Trips',
    description: '',
    sql: 'select 1',
    dataSourceId: 2,
    vizChoiceId: 'chart-bar',
    vizOptions: { showDataLabels: true, bogus: 1 },
  },
}
const DRAFT = { id: 'd1', versions: [PROPOSAL], promotions: [] } as DraftView

function promoted(receipts: ChatPromotion['receipts']): ChatPromotion {
  return { id: 'p1', receipts } as ChatPromotion
}

beforeEach(() => {
  vi.clearAllMocks()
  services.createVisualization.mockResolvedValue({ id: 9 })
  services.updateVisualization.mockResolvedValue({ id: 7 })
})

describe('writeChart', () => {
  it('creates the chart with only the options its type declares', async () => {
    await writeChart(DRAFT, promoted([]), 44, PROPOSAL)
    expect(services.createVisualization).toHaveBeenCalledWith(
      expect.objectContaining({ options: { globalSeriesType: 'bar', showDataLabels: true }, idempotency_key: 'd1:2:1' })
    )
  })

  it('merges the declared options over the chart that failed to update', async () => {
    services.get.mockResolvedValue({ visualizations: [{ id: 7, options: { legend: true } }] })
    await writeChart(DRAFT, promoted([{ step: 1, outcome: 'failed', targetId: '7' }]), 44, PROPOSAL)
    expect(services.updateVisualization).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ options: { legend: true, globalSeriesType: 'bar', showDataLabels: true } })
    )
  })
})
