import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DashboardDraftView, DraftView } from '@/lib/chat/thread-model'
import { querySync } from '@/test/query-sync'
import { renderWithProviders } from '@/test/utils'
import { DashboardDraftActions } from './dashboard-draft-actions'

const mocks = vi.hoisted(() => ({
  write: vi.fn(),
  queriesGet: vi.fn(),
  dashboardsCreate: vi.fn(),
  createWidget: vi.fn(),
  createVisualization: vi.fn(),
  updateVisualization: vi.fn(),
  dashboardsGet: vi.fn(),
  recordPromotion: vi.fn(),
  patchPromotion: vi.fn(),
}))

vi.mock('@/components/chat/proposal-kit/use-write-proposed-query', () => ({
  useWriteProposedQuery: () => ({ write: mocks.write, isPending: false }),
}))
vi.mock('@/services/redash/queries', () => ({ get: mocks.queriesGet }))
vi.mock('@/services/redash/dashboards', () => ({ create: mocks.dashboardsCreate, get: mocks.dashboardsGet }))
vi.mock('@/services/redash/widgets', () => ({ createWidget: mocks.createWidget }))
vi.mock('@/services/redash/visualizations', () => ({
  createVisualization: mocks.createVisualization,
  updateVisualization: mocks.updateVisualization,
}))
vi.mock('@/services/ai/chat-client', () => ({
  recordPromotion: mocks.recordPromotion,
  patchPromotion: mocks.patchPromotion,
}))

const QUERY_PAYLOAD = {
  name: 'Average speed',
  description: '',
  sql: 'SELECT 1',
  dataSourceId: 5,
  vizChoiceId: 'counter',
  vizOptions: {},
}

const PARTIAL = {
  id: 'qp1',
  targetType: 'query',
  targetId: '55',
  promotedVersion: 1,
  targetVersionAtPromote: null,
  status: 'partial' as const,
  receipts: [
    { step: 0, outcome: 'done' as const, targetId: '55' },
    { step: 1, outcome: 'failed' as const, error: 'viz refused' },
  ],
  createdAt: 'x',
  updatedAt: 'x',
}

const QUERY_DRAFT: DraftView = {
  id: 'qd1',
  versions: [{ version: 1, payload: QUERY_PAYLOAD }],
  promotions: [PARTIAL],
}

const DASHBOARD: DashboardDraftView = {
  id: 'dd1',
  versions: [
    {
      version: 1,
      payload: { name: 'Overview', description: '', items: [{ kind: 'draft', queryDraftId: 'qd1', title: 'Speed' }] },
    },
  ],
  promotions: [],
}

function renderSave() {
  renderWithProviders(
    <DashboardDraftActions
      draft={DASHBOARD}
      queryDrafts={{ qd1: QUERY_DRAFT }}
      activeDashboard={null}
      onQueryPromoted={vi.fn()}
      querySync={querySync()}
      onDashboardPromoted={vi.fn()}
      onDashboardActive={vi.fn()}
    />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.queriesGet.mockResolvedValue({ id: 55, visualizations: [{ id: 60, type: 'TABLE' }] })
  mocks.dashboardsCreate.mockResolvedValue({ id: 9, name: 'Overview' })
  mocks.createWidget.mockResolvedValue({ id: 301, updated_at: 'w' })
  mocks.recordPromotion.mockResolvedValue({ id: 'p1', receipts: [] })
  mocks.patchPromotion.mockImplementation(async (_d: string, id: string, patch: object) => ({ id, ...patch }))
})

describe('DashboardDraftActions: a query draft whose chart step failed', () => {
  it('retries the chart with the same step-1 key before adding the widget', async () => {
    mocks.createVisualization.mockResolvedValue({ id: 88 })
    renderSave()
    await userEvent.click(screen.getByRole('button', { name: 'Save as new dashboard' }))
    await waitFor(() => expect(mocks.createWidget).toHaveBeenCalled())
    expect(mocks.createVisualization).toHaveBeenCalledWith(
      expect.objectContaining({ query_id: 55, type: 'COUNTER', idempotency_key: 'qd1:1:1' })
    )
    expect(mocks.createWidget).toHaveBeenCalledWith(expect.objectContaining({ visualization_id: 88 }))
    expect(mocks.write).not.toHaveBeenCalled()
    expect(mocks.patchPromotion).toHaveBeenCalledWith(
      'qd1',
      'qp1',
      expect.objectContaining({
        status: 'done',
        receipts: [
          { step: 0, outcome: 'done', targetId: '55' },
          { step: 1, outcome: 'done', targetId: '88' },
        ],
      })
    )
  })

  it('skips the item and names the reason when the chart still cannot be created', async () => {
    mocks.createVisualization.mockRejectedValue(new Error('viz refused again'))
    renderSave()
    await userEvent.click(screen.getByRole('button', { name: 'Save as new dashboard' }))
    expect(await screen.findByText('Skipped: Speed (chart not created: viz refused again).')).toBeInTheDocument()
    expect(mocks.createWidget).not.toHaveBeenCalled()
  })
})

describe('DashboardDraftActions: a chart step that failed as an update', () => {
  it('retries the update on the same visualization instead of creating a duplicate', async () => {
    const updating = {
      ...PARTIAL,
      receipts: [
        { step: 0, outcome: 'done' as const, targetId: '55' },
        { step: 1, outcome: 'failed' as const, error: 'chart refused', targetId: '60' },
      ],
    }
    mocks.queriesGet.mockResolvedValue({ id: 55, visualizations: [{ id: 60, type: 'COUNTER', options: { legend: true } }] })
    mocks.updateVisualization.mockResolvedValue({ id: 60 })
    renderWithProviders(
      <DashboardDraftActions
        draft={DASHBOARD}
        queryDrafts={{ qd1: { ...QUERY_DRAFT, promotions: [updating] } }}
        activeDashboard={null}
        onQueryPromoted={vi.fn()}
        querySync={querySync()}
        onDashboardPromoted={vi.fn()}
        onDashboardActive={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save as new dashboard' }))
    await waitFor(() => expect(mocks.createWidget).toHaveBeenCalled())
    expect(mocks.updateVisualization).toHaveBeenCalledWith(60, expect.objectContaining({ options: expect.objectContaining({ legend: true }) }))
    expect(mocks.createVisualization).not.toHaveBeenCalled()
    expect(mocks.createWidget).toHaveBeenCalledWith(expect.objectContaining({ visualization_id: 60 }))
  })
})

describe('DashboardDraftActions: a dashboard whose record did not sync', () => {
  const plain: DashboardDraftView = DASHBOARD

  function renderWith(active: { id: number; name: string; widgetCount: number } | null, handlers: { promoted: () => void; activated: () => void }) {
    renderWithProviders(
      <DashboardDraftActions
        draft={plain}
        queryDrafts={{ qd1: { ...QUERY_DRAFT, promotions: [] } }}
        activeDashboard={active}
        onQueryPromoted={vi.fn()}
        querySync={querySync()}
        onDashboardPromoted={handlers.promoted}
        onDashboardActive={handlers.activated}
      />
    )
  }

  function failDashboardPatchOnce() {
    let failed = false
    mocks.patchPromotion.mockImplementation(async (draftId: string, id: string, patch: object) => {
      if (draftId === 'dd1' && !failed) {
        failed = true
        throw new Error('sidecar down')
      }
      return { id, ...patch }
    })
  }

  beforeEach(() => {
    mocks.write.mockResolvedValue({ queryId: 100, visualizationId: 200 })
    mocks.dashboardsGet.mockResolvedValue({ id: 9, widgets: [] })
  })

  it('Save says so and retries only the record', async () => {
    failDashboardPatchOnce()
    const handlers = { promoted: vi.fn(), activated: vi.fn() }
    renderWith(null, handlers)
    await userEvent.click(screen.getByRole('button', { name: 'Save as new dashboard' }))
    expect(await screen.findByText('Saved, but the record of it did not save.')).toBeInTheDocument()
    expect(handlers.activated).toHaveBeenCalled()
    expect(handlers.promoted).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(handlers.promoted).toHaveBeenCalled())
    expect(mocks.dashboardsCreate).toHaveBeenCalledTimes(1)
  })

  it('append says so and retries only the record', async () => {
    failDashboardPatchOnce()
    const handlers = { promoted: vi.fn(), activated: vi.fn() }
    renderWith({ id: 9, name: 'Overview', widgetCount: 0 }, handlers)
    await userEvent.click(screen.getByRole('button', { name: 'Add to Overview' }))
    expect(await screen.findByText('Saved, but the record of it did not save.')).toBeInTheDocument()
    expect(handlers.promoted).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(handlers.promoted).toHaveBeenCalled())
    expect(mocks.createWidget).toHaveBeenCalledTimes(1)
  })
})
