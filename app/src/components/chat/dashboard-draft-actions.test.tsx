import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActiveDashboard, DashboardDraftView, DraftView } from '@/lib/chat/thread-model'
import { querySync } from '@/test/query-sync'
import { renderWithProviders } from '@/test/utils'
import { DASHBOARD_CONFLICT_MESSAGE, DashboardDraftActions } from './dashboard-draft-actions'

const mocks = vi.hoisted(() => ({
  write: vi.fn(),
  queriesGet: vi.fn(),
  dashboardsCreate: vi.fn(),
  dashboardsGet: vi.fn(),
  createWidget: vi.fn(),
  recordPromotion: vi.fn(),
  patchPromotion: vi.fn(),
}))

vi.mock('@/components/chat/proposal-kit/use-write-proposed-query', () => ({
  useWriteProposedQuery: () => ({ write: mocks.write, isPending: false }),
}))
vi.mock('@/services/redash/queries', () => ({ get: mocks.queriesGet }))
vi.mock('@/services/redash/dashboards', () => ({ create: mocks.dashboardsCreate, get: mocks.dashboardsGet }))
vi.mock('@/services/redash/widgets', () => ({ createWidget: mocks.createWidget }))
vi.mock('@/services/ai/chat-client', () => ({
  recordPromotion: mocks.recordPromotion,
  patchPromotion: mocks.patchPromotion,
}))

const QUERY_DRAFT_PAYLOAD = {
  name: 'Average speed',
  description: '',
  sql: 'SELECT 1',
  dataSourceId: 5,
  datasetTable: 't',
  vizChoiceId: 'counter',
  vizOptions: {},
}

function queryDraft(overrides: Partial<DraftView> = {}): DraftView {
  return { id: 'qd1', versions: [{ version: 1, payload: QUERY_DRAFT_PAYLOAD }], promotions: [], ...overrides }
}

const DASHBOARD_PAYLOAD = {
  name: 'Bikeshare overview',
  description: '',
  items: [
    { kind: 'draft' as const, queryDraftId: 'qd1', title: 'Speed' },
    { kind: 'existing' as const, queryId: 12, visualizationId: 31, title: 'Trips' },
  ],
}

function dashboardDraft(overrides: Partial<DashboardDraftView> = {}): DashboardDraftView {
  return { id: 'dd1', versions: [{ version: 1, payload: DASHBOARD_PAYLOAD }], promotions: [], ...overrides }
}

function existingQuery(overrides: Record<string, unknown> = {}) {
  return { id: 12, visualizations: [{ id: 30, type: 'TABLE' }, { id: 31, type: 'CHART' }], ...overrides }
}

const ACTIVE: ActiveDashboard = { id: 9, name: 'Bikeshare overview', widgetCount: 2 }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.write.mockResolvedValue({ queryId: 100, visualizationId: 200 })
  mocks.queriesGet.mockImplementation(async (id: number) => (id === 12 ? existingQuery() : null))
  mocks.dashboardsCreate.mockResolvedValue({ id: 9, name: 'Bikeshare overview' })
  mocks.createWidget.mockResolvedValueOnce({ id: 301, updated_at: 'w1' }).mockResolvedValue({ id: 302, updated_at: 'w2' })
  mocks.recordPromotion.mockImplementation(async (_draftId: string, body: Record<string, unknown>) => ({
    id: 'p1',
    createdAt: 'x',
    updatedAt: 'x',
    receipts: [],
    targetId: null,
    targetVersionAtPromote: null,
    promotedVersion: body.version,
    ...body,
  }))
  mocks.patchPromotion.mockImplementation(async (_draftId: string, id: string, patch: Record<string, unknown>) => ({
    id,
    targetType: 'dashboard',
    createdAt: 'x',
    updatedAt: 'y',
    promotedVersion: 1,
    targetVersionAtPromote: null,
    ...patch,
  }))
})

describe('DashboardDraftActions: creating a new dashboard', () => {
  it('promotes an unpromoted query-draft item (B7), reuses an existing item, and records both promotions', async () => {
    const onQueryPromoted = vi.fn()
    const onDashboardPromoted = vi.fn()
    const onDashboardActive = vi.fn()
    renderWithProviders(
      <DashboardDraftActions
        draft={dashboardDraft()}
        queryDrafts={{ qd1: queryDraft() }}
        activeDashboard={null}
        onQueryPromoted={onQueryPromoted}
        querySync={querySync()}
        onDashboardPromoted={onDashboardPromoted}
        onDashboardActive={onDashboardActive}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save as new dashboard' }))
    await waitFor(() => expect(onDashboardPromoted).toHaveBeenCalled())

    expect(mocks.write).toHaveBeenCalledWith(QUERY_DRAFT_PAYLOAD, QUERY_DRAFT_PAYLOAD.dataSourceId, {
      idempotencyKeys: { query: 'qd1:1:0', visualization: 'qd1:1:1' },
      onCreated: expect.any(Function),
    })
    expect(onQueryPromoted).toHaveBeenCalledWith('qd1', expect.objectContaining({ status: 'done', targetId: '100' }))
    expect(mocks.dashboardsCreate).toHaveBeenCalledWith({ name: 'Bikeshare overview', idempotency_key: 'dd1:1:0' })
    expect(mocks.createWidget).toHaveBeenNthCalledWith(1, {
      dashboard_id: 9,
      visualization_id: 200,
      options: { position: { col: 0, row: 0, sizeX: 3, sizeY: 6 } },
      idempotency_key: 'dd1:1:1',
    })
    expect(mocks.createWidget).toHaveBeenNthCalledWith(2, {
      dashboard_id: 9,
      visualization_id: 31,
      options: { position: { col: 3, row: 0, sizeX: 3, sizeY: 6 } },
      idempotency_key: 'dd1:1:2',
    })
    expect(mocks.recordPromotion).toHaveBeenCalledWith('dd1', { version: 1, targetType: 'dashboard', status: 'pending' })
    expect(mocks.patchPromotion).toHaveBeenCalledWith('dd1', 'p1', {
      status: 'done',
      targetId: '9',
      receipts: [
        { step: 0, outcome: 'done', targetId: '9', updatedAt: undefined },
        { step: 1, outcome: 'done', targetId: '301', updatedAt: 'w1' },
        { step: 2, outcome: 'done', targetId: '302', updatedAt: 'w2' },
      ],
      targetVersionAtPromote: 2,
    })
    expect(onDashboardPromoted).toHaveBeenCalledWith('dd1', expect.objectContaining({ status: 'done', targetId: '9' }))
    expect(onDashboardActive).toHaveBeenCalledWith({ id: 9, name: 'Bikeshare overview', widgetCount: 2 })
  })

  it('reuses an already-promoted query draft instead of writing it again', async () => {
    const promoted = queryDraft({
      promotions: [{ id: 'p0', targetType: 'query', targetId: '55', promotedVersion: 1, targetVersionAtPromote: null, status: 'done' as const, receipts: [], createdAt: 'x', updatedAt: 'x' }],
    })
    mocks.queriesGet.mockImplementation(async (id: number) =>
      id === 55 ? { id: 55, visualizations: [{ id: 60, type: 'CHART' }] } : id === 12 ? existingQuery() : null
    )
    renderWithProviders(
      <DashboardDraftActions
        draft={dashboardDraft()}
        queryDrafts={{ qd1: promoted }}
        activeDashboard={null}
        onQueryPromoted={vi.fn()}
        querySync={querySync()}
        onDashboardPromoted={vi.fn()}
        onDashboardActive={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save as new dashboard' }))
    await waitFor(() => expect(mocks.dashboardsCreate).toHaveBeenCalled())
    expect(mocks.write).not.toHaveBeenCalled()
    expect(mocks.createWidget).toHaveBeenCalledWith(expect.objectContaining({ visualization_id: 60 }))
  })

  it('skips a missing existing query, reports it, and still creates the rest', async () => {
    mocks.queriesGet.mockImplementation(async () => null)
    mocks.write.mockResolvedValue({ queryId: 100, visualizationId: 200 })
    renderWithProviders(
      <DashboardDraftActions
        draft={dashboardDraft()}
        queryDrafts={{ qd1: queryDraft() }}
        activeDashboard={null}
        onQueryPromoted={vi.fn()}
        querySync={querySync()}
        onDashboardPromoted={vi.fn()}
        onDashboardActive={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save as new dashboard' }))
    await waitFor(() => expect(screen.getByText('Skipped: Trips.')).toBeInTheDocument())
    expect(mocks.createWidget).toHaveBeenCalledTimes(1)
    expect(mocks.patchPromotion).toHaveBeenCalledWith(
      'dd1',
      'p1',
      expect.objectContaining({ status: 'done', targetId: '9', targetVersionAtPromote: 1 })
    )
  })
})

describe('DashboardDraftActions: idempotency and partial outcomes', () => {
  function renderSave() {
    renderWithProviders(
      <DashboardDraftActions
        draft={dashboardDraft()}
        queryDrafts={{ qd1: queryDraft() }}
        activeDashboard={null}
        onQueryPromoted={vi.fn()}
        querySync={querySync()}
        onDashboardPromoted={vi.fn()}
        onDashboardActive={vi.fn()}
      />
    )
  }

  it('Save twice sends the same keys for the dashboard and each widget', async () => {
    renderSave()
    await userEvent.click(screen.getByRole('button', { name: 'Save as new dashboard' }))
    await waitFor(() => expect(mocks.createWidget).toHaveBeenCalledTimes(2))
    await userEvent.click(screen.getByRole('button', { name: 'Save as new dashboard' }))
    await waitFor(() => expect(mocks.createWidget).toHaveBeenCalledTimes(4))
    const keys = (calls: unknown[][]) => calls.map((call) => (call[0] as { idempotency_key: string }).idempotency_key)
    expect(keys(mocks.createWidget.mock.calls.slice(0, 2))).toEqual(['dd1:1:1', 'dd1:1:2'])
    expect(keys(mocks.createWidget.mock.calls.slice(2))).toEqual(['dd1:1:1', 'dd1:1:2'])
    expect(mocks.dashboardsCreate.mock.calls.map((call) => call[0].idempotency_key)).toEqual(['dd1:1:0', 'dd1:1:0'])
  })

  it('records a partial outcome naming the failed step when a widget write fails', async () => {
    mocks.createWidget.mockReset()
    mocks.createWidget.mockResolvedValueOnce({ id: 301, updated_at: 'w1' }).mockRejectedValueOnce(new Error('node refused'))
    renderSave()
    await userEvent.click(screen.getByRole('button', { name: 'Save as new dashboard' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('node refused')
    expect(mocks.patchPromotion).toHaveBeenCalledWith('dd1', 'p1', {
      status: 'partial',
      targetId: '9',
      receipts: [
        { step: 0, outcome: 'done', targetId: '9', updatedAt: undefined },
        { step: 1, outcome: 'done', targetId: '301', updatedAt: 'w1' },
        { step: 2, outcome: 'failed', error: 'node refused' },
      ],
    })
  })
})

describe('DashboardDraftActions: appending to an active dashboard', () => {
  it('offers Add to {name} only when a dashboard is active, and appends after its current widgets', async () => {
    renderWithProviders(
      <DashboardDraftActions
        draft={dashboardDraft()}
        queryDrafts={{ qd1: queryDraft() }}
        activeDashboard={ACTIVE}
        onQueryPromoted={vi.fn()}
        querySync={querySync()}
        onDashboardPromoted={vi.fn()}
        onDashboardActive={vi.fn()}
      />
    )
    mocks.dashboardsGet.mockResolvedValue({
      id: 9,
      widgets: [
        { options: { position: { col: 0, row: 0, sizeX: 6, sizeY: 8 } }, visualization: { id: 1 } },
        { options: { position: { col: 0, row: 8, sizeX: 6, sizeY: 8 } }, visualization: { id: 2 } },
      ],
    })
    await userEvent.click(screen.getByRole('button', { name: 'Add to Bikeshare overview' }))
    await waitFor(() => expect(mocks.createWidget).toHaveBeenCalled())
    expect(mocks.createWidget).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ options: { position: { col: 0, row: 16, sizeX: 3, sizeY: 6 } }, idempotency_key: 'dd1:1:d9:1' })
    )
    expect(mocks.recordPromotion).toHaveBeenCalledWith('dd1', expect.objectContaining({ targetId: '9', status: 'pending' }))
  })

  async function appendTo(active: ActiveDashboard) {
    mocks.dashboardsGet.mockResolvedValue({
      id: active.id,
      widgets: [
        { options: { position: { col: 0, row: 0, sizeX: 3, sizeY: 8 } }, visualization: { id: 1 } },
        { options: { position: { col: 0, row: 8, sizeX: 3, sizeY: 8 } }, visualization: { id: 2 } },
      ],
    })
    const view = renderWithProviders(
      <DashboardDraftActions
        draft={dashboardDraft()}
        queryDrafts={{ qd1: queryDraft() }}
        activeDashboard={active}
        onQueryPromoted={vi.fn()}
        querySync={querySync()}
        onDashboardPromoted={vi.fn()}
        onDashboardActive={vi.fn()}
      />
    )
    const before = mocks.createWidget.mock.calls.length
    await userEvent.click(screen.getByRole('button', { name: `Add to ${active.name}` }))
    await waitFor(() => expect(mocks.createWidget).toHaveBeenCalledTimes(before + 2))
    view.unmount()
    return mocks.createWidget.mock.calls.slice(before).map((call) => call[0].idempotency_key)
  }

  it('repeating a successful append records the widget count unchanged', async () => {
    mocks.createWidget.mockReset()
    mocks.createWidget.mockResolvedValueOnce({ id: 301, updated_at: 'w1' }).mockResolvedValueOnce({ id: 302, updated_at: 'w2' })
    mocks.dashboardsGet.mockResolvedValue({
      id: 9,
      widgets: [1, 2, 301, 302].map((id) => ({ id, options: { position: { col: 0, row: id, sizeX: 3, sizeY: 8 } }, visualization: { id } })),
    })
    const onDashboardActive = vi.fn()
    renderWithProviders(
      <DashboardDraftActions
        draft={dashboardDraft()}
        queryDrafts={{ qd1: queryDraft() }}
        activeDashboard={{ ...ACTIVE, widgetCount: 4 }}
        onQueryPromoted={vi.fn()}
        querySync={querySync()}
        onDashboardPromoted={vi.fn()}
        onDashboardActive={onDashboardActive}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Add to Bikeshare overview' }))
    await waitFor(() => expect(onDashboardActive).toHaveBeenCalled())
    expect(onDashboardActive).toHaveBeenCalledWith({ id: 9, name: 'Bikeshare overview', widgetCount: 4 })
    expect(mocks.patchPromotion).toHaveBeenLastCalledWith('dd1', 'p1', expect.objectContaining({ targetVersionAtPromote: 4 }))
  })

  it('append of the same version to two dashboards sends distinct keys', async () => {
    const first = await appendTo(ACTIVE)
    expect(mocks.patchPromotion).toHaveBeenLastCalledWith('dd1', 'p1', expect.objectContaining({ targetVersionAtPromote: 4 }))
    const second = await appendTo({ ...ACTIVE, id: 10 })
    expect(first).toEqual(['dd1:1:d9:1', 'dd1:1:d9:2'])
    expect(second).toEqual(['dd1:1:d10:1', 'dd1:1:d10:2'])
  })

  it('retrying an append to the same dashboard sends the same keys', async () => {
    const first = await appendTo(ACTIVE)
    const retry = await appendTo(ACTIVE)
    expect(retry).toEqual(first)
  })

  it('warns when the dashboard drifted since it was opened, and Add anyway proceeds', async () => {
    renderWithProviders(
      <DashboardDraftActions
        draft={dashboardDraft()}
        queryDrafts={{ qd1: queryDraft() }}
        activeDashboard={ACTIVE}
        onQueryPromoted={vi.fn()}
        querySync={querySync()}
        onDashboardPromoted={vi.fn()}
        onDashboardActive={vi.fn()}
      />
    )
    mocks.dashboardsGet.mockResolvedValue({
      id: 9,
      widgets: [
        { options: { position: { col: 0, row: 0, sizeX: 3, sizeY: 8 } }, visualization: { id: 1 } },
        { options: { position: { col: 0, row: 8, sizeX: 3, sizeY: 8 } }, visualization: { id: 2 } },
        { options: { position: { col: 0, row: 16, sizeX: 3, sizeY: 8 } }, visualization: { id: 3 } },
      ],
    })
    await userEvent.click(screen.getByRole('button', { name: 'Add to Bikeshare overview' }))
    expect(await screen.findByText(DASHBOARD_CONFLICT_MESSAGE)).toBeInTheDocument()
    expect(mocks.createWidget).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Add anyway' }))
    await waitFor(() => expect(mocks.createWidget).toHaveBeenCalled())
  })
})
