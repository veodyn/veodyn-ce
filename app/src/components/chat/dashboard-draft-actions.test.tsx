import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActiveDashboard, DashboardDraftView, DraftView } from '@/lib/chat/thread-model'
import { renderWithProviders } from '@/test/utils'
import { DASHBOARD_CONFLICT_MESSAGE, DashboardDraftActions } from './dashboard-draft-actions'

const mocks = vi.hoisted(() => ({
  write: vi.fn(),
  queriesGet: vi.fn(),
  dashboardsCreate: vi.fn(),
  dashboardsGet: vi.fn(),
  createWidget: vi.fn(),
  recordPromotion: vi.fn(),
}))

vi.mock('@/components/ai/create-chat/proposals/use-write-proposed-query', () => ({
  useWriteProposedQuery: () => ({ write: mocks.write, isPending: false }),
}))
vi.mock('@/services/redash/queries', () => ({ get: mocks.queriesGet }))
vi.mock('@/services/redash/dashboards', () => ({ create: mocks.dashboardsCreate, get: mocks.dashboardsGet }))
vi.mock('@/services/redash/widgets', () => ({ createWidget: mocks.createWidget }))
vi.mock('@/services/ai/chat-client', () => ({ recordPromotion: mocks.recordPromotion }))

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
  mocks.createWidget.mockResolvedValue({})
  mocks.recordPromotion.mockImplementation(async (_draftId: string, body: Record<string, unknown>) => ({
    id: 'p1',
    createdAt: 'x',
    promotedVersion: body.version,
    ...body,
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
        onDashboardPromoted={onDashboardPromoted}
        onDashboardActive={onDashboardActive}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save as new dashboard' }))
    await waitFor(() => expect(onDashboardPromoted).toHaveBeenCalled())

    expect(mocks.write).toHaveBeenCalledWith(QUERY_DRAFT_PAYLOAD, QUERY_DRAFT_PAYLOAD.dataSourceId)
    expect(onQueryPromoted).toHaveBeenCalledWith('qd1', expect.objectContaining({ targetType: 'query' }))
    expect(mocks.dashboardsCreate).toHaveBeenCalledWith({ name: 'Bikeshare overview' })
    expect(mocks.createWidget).toHaveBeenNthCalledWith(1, {
      dashboard_id: 9,
      visualization_id: 200,
      options: { position: { col: 0, row: 0, sizeX: 3, sizeY: 8 } },
    })
    expect(mocks.createWidget).toHaveBeenNthCalledWith(2, {
      dashboard_id: 9,
      visualization_id: 31,
      options: { position: { col: 0, row: 8, sizeX: 3, sizeY: 8 } },
    })
    expect(mocks.recordPromotion).toHaveBeenCalledWith('dd1', {
      version: 1,
      targetType: 'dashboard',
      targetId: '9',
      targetVersionAtPromote: 2,
    })
    expect(onDashboardPromoted).toHaveBeenCalledWith('dd1', expect.objectContaining({ targetType: 'dashboard' }))
    expect(onDashboardActive).toHaveBeenCalledWith({ id: 9, name: 'Bikeshare overview', widgetCount: 2 })
  })

  it('reuses an already-promoted query draft instead of writing it again', async () => {
    const promoted = queryDraft({
      promotions: [{ id: 'p0', targetType: 'query', targetId: '55', promotedVersion: 1, targetVersionAtPromote: null, createdAt: 'x' }],
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
        onDashboardPromoted={vi.fn()}
        onDashboardActive={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save as new dashboard' }))
    await waitFor(() => expect(screen.getByText('Skipped: Trips.')).toBeInTheDocument())
    expect(mocks.createWidget).toHaveBeenCalledTimes(1)
    expect(mocks.recordPromotion).toHaveBeenCalledWith('dd1', expect.objectContaining({ targetVersionAtPromote: 1 }))
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
        onDashboardPromoted={vi.fn()}
        onDashboardActive={vi.fn()}
      />
    )
    mocks.dashboardsGet.mockResolvedValue({
      id: 9,
      widgets: [
        { options: { position: { row: 0 } }, visualization: { id: 1 } },
        { options: { position: { row: 8 } }, visualization: { id: 2 } },
      ],
    })
    await userEvent.click(screen.getByRole('button', { name: 'Add to Bikeshare overview' }))
    await waitFor(() => expect(mocks.createWidget).toHaveBeenCalled())
    expect(mocks.createWidget).toHaveBeenNthCalledWith(1, expect.objectContaining({ options: { position: { col: 0, row: 16, sizeX: 3, sizeY: 8 } } }))
    expect(mocks.recordPromotion).toHaveBeenCalledWith('dd1', expect.objectContaining({ targetId: '9', targetVersionAtPromote: 4 }))
  })

  it('warns when the dashboard drifted since it was opened, and Add anyway proceeds', async () => {
    renderWithProviders(
      <DashboardDraftActions
        draft={dashboardDraft()}
        queryDrafts={{ qd1: queryDraft() }}
        activeDashboard={ACTIVE}
        onQueryPromoted={vi.fn()}
        onDashboardPromoted={vi.fn()}
        onDashboardActive={vi.fn()}
      />
    )
    mocks.dashboardsGet.mockResolvedValue({
      id: 9,
      widgets: [
        { options: { position: { row: 0 } }, visualization: { id: 1 } },
        { options: { position: { row: 8 } }, visualization: { id: 2 } },
        { options: { position: { row: 16 } }, visualization: { id: 3 } },
      ],
    })
    await userEvent.click(screen.getByRole('button', { name: 'Add to Bikeshare overview' }))
    expect(await screen.findByText(DASHBOARD_CONFLICT_MESSAGE)).toBeInTheDocument()
    expect(mocks.createWidget).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Add anyway' }))
    await waitFor(() => expect(mocks.createWidget).toHaveBeenCalled())
  })
})
