import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActiveDashboard, DashboardDraftView } from '@/lib/chat/thread-model'
import { querySync } from '@/test/query-sync'
import { renderWithProviders } from '@/test/utils'
import { DashboardDraftActions } from './dashboard-draft-actions'

const mocks = vi.hoisted(() => ({
  queriesGet: vi.fn(),
  dashboardsCreate: vi.fn(),
  dashboardsGet: vi.fn(),
  createWidget: vi.fn(),
  recordPromotion: vi.fn(),
  patchPromotion: vi.fn(),
}))

vi.mock('@/components/chat/proposal-kit/use-write-proposed-query', () => ({
  useWriteProposedQuery: () => ({ write: vi.fn(), isPending: false }),
}))
vi.mock('@/services/redash/queries', () => ({ get: mocks.queriesGet }))
vi.mock('@/services/redash/dashboards', () => ({ create: mocks.dashboardsCreate, get: mocks.dashboardsGet }))
vi.mock('@/services/redash/widgets', () => ({ createWidget: mocks.createWidget }))
vi.mock('@/services/ai/chat-client', () => ({
  recordPromotion: mocks.recordPromotion,
  patchPromotion: mocks.patchPromotion,
}))

const PAYLOAD = {
  name: 'Overview',
  description: '',
  items: [
    { kind: 'existing' as const, queryId: 12, visualizationId: 31 },
    { kind: 'text' as const, text: 'Notes' },
    { kind: 'existing' as const, queryId: 12, visualizationId: 30 },
  ],
}

function draft(): DashboardDraftView {
  return { id: 'dd1', versions: [{ version: 1, payload: PAYLOAD }], promotions: [] }
}

function render(active: ActiveDashboard | null, handlers: { active?: () => void } = {}) {
  return renderWithProviders(
    <DashboardDraftActions
      draft={draft()}
      queryDrafts={{}}
      activeDashboard={active}
      onQueryPromoted={vi.fn()}
      querySync={querySync()}
      onDashboardPromoted={vi.fn()}
      onDashboardActive={handlers.active ?? vi.fn()}
    />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.queriesGet.mockResolvedValue({ id: 12, visualizations: [{ id: 30, type: 'TABLE' }, { id: 31, type: 'CHART' }] })
  mocks.dashboardsCreate.mockResolvedValue({ id: 9, name: 'Overview' })
  let next = 300
  mocks.createWidget.mockImplementation(async () => ({ id: (next += 1), updated_at: 'w' }))
  mocks.recordPromotion.mockImplementation(async (_d: string, body: Record<string, unknown>) => ({
    id: 'p1',
    createdAt: 'x',
    updatedAt: 'x',
    receipts: [],
    targetId: null,
    targetVersionAtPromote: null,
    promotedVersion: body.version,
    ...body,
  }))
  mocks.patchPromotion.mockImplementation(async (_d: string, id: string, patch: Record<string, unknown>) => ({
    id,
    targetType: 'dashboard',
    createdAt: 'x',
    updatedAt: 'y',
    promotedVersion: 1,
    targetVersionAtPromote: null,
    ...patch,
  }))
})

describe('saving a dashboard proposal with text items', () => {
  it('lays charts and text out with the add-widget dialog helpers, text as a widget without a visualization', async () => {
    const onActive = vi.fn()
    render(null, { active: onActive })
    await userEvent.click(screen.getByRole('button', { name: 'Save as new dashboard' }))
    await waitFor(() => expect(onActive).toHaveBeenCalled())
    expect(mocks.createWidget.mock.calls.map((call) => call[0])).toEqual([
      {
        dashboard_id: 9,
        visualization_id: 31,
        options: { position: { col: 0, row: 0, sizeX: 3, sizeY: 6 } },
        idempotency_key: 'dd1:1:1',
      },
      {
        dashboard_id: 9,
        visualization_id: null,
        text: 'Notes',
        options: { position: { col: 0, row: 6, sizeX: 6, sizeY: 4 } },
        idempotency_key: 'dd1:1:2',
      },
      {
        dashboard_id: 9,
        visualization_id: 30,
        options: { position: { col: 0, row: 10, sizeX: 3, sizeY: 8 } },
        idempotency_key: 'dd1:1:3',
      },
    ])
  })

  it('does not count the text widget as a chart in the recorded count', async () => {
    const onActive = vi.fn()
    render(null, { active: onActive })
    await userEvent.click(screen.getByRole('button', { name: 'Save as new dashboard' }))
    await waitFor(() => expect(onActive).toHaveBeenCalled())
    expect(onActive).toHaveBeenCalledWith({ id: 9, name: 'Overview', widgetCount: 2 })
    expect(mocks.patchPromotion).toHaveBeenLastCalledWith('dd1', 'p1', expect.objectContaining({ targetVersionAtPromote: 2 }))
  })

  it('does not see a text widget on the dashboard as drift when appending', async () => {
    mocks.dashboardsGet.mockResolvedValue({
      id: 9,
      widgets: [
        { id: 1, options: { position: { col: 0, row: 0, sizeX: 3, sizeY: 8 } }, visualization: { id: 1 } },
        { id: 2, options: { position: { col: 0, row: 8, sizeX: 6, sizeY: 4 } }, text: 'hi' },
      ],
    })
    const onActive = vi.fn()
    render({ id: 9, name: 'Overview', widgetCount: 1 }, { active: onActive })
    await userEvent.click(screen.getByRole('button', { name: 'Add to Overview' }))
    await waitFor(() => expect(onActive).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Add anyway' })).not.toBeInTheDocument()
    expect(onActive).toHaveBeenCalledWith({ id: 9, name: 'Overview', widgetCount: 3 })
  })
})
