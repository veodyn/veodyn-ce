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

const LIVE_ROUTE_QUERY = {
  id: 137,
  name: 'Live route',
  visualizations: [{ id: 240, type: 'TABLE' }],
  options: {
    parameters: [
      { name: 'route', title: 'Route', type: 'text', value: 'MT020' },
      { name: 'direction', title: '', type: 'text', value: '0' },
    ],
  },
}

const PREVIEWED = {
  kind: 'existing' as const,
  queryId: 137,
  visualizationId: 240,
  parameters: { route: 'MT720', direction: '1', notAParameter: 'x' },
}

const PINNED_MAPPINGS = {
  route: { type: 'static-value', mapTo: 'route', value: 'MT720', title: 'Route' },
  direction: { type: 'static-value', mapTo: 'direction', value: '1', title: 'direction' },
}

function draft(items: DashboardDraftView['versions'][number]['payload']['items']): DashboardDraftView {
  return { id: 'dd1', versions: [{ version: 1, payload: { name: 'Main Terminal & Route 7', description: '', items } }], promotions: [] }
}

function render(
  items: DashboardDraftView['versions'][number]['payload']['items'],
  active: ActiveDashboard | null,
  onActive: () => void
) {
  return renderWithProviders(
    <DashboardDraftActions
      draft={draft(items)}
      queryDrafts={{}}
      activeDashboard={active}
      onQueryPromoted={vi.fn()}
      querySync={querySync()}
      onDashboardPromoted={vi.fn()}
      onDashboardActive={onActive}
    />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.queriesGet.mockResolvedValue(LIVE_ROUTE_QUERY)
  mocks.dashboardsGet.mockResolvedValue({ id: 5, name: 'Ops', widgets: [] })
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

describe('saving a proposed widget the chat previewed with parameter values', () => {
  it('pins each value the query declares as a static value, the way the add-widget dialog stores one', async () => {
    const onActive = vi.fn()
    render([PREVIEWED], null, onActive)
    await userEvent.click(screen.getByRole('button', { name: 'Save as new dashboard' }))
    await waitFor(() => expect(onActive).toHaveBeenCalled())
    expect(mocks.createWidget).toHaveBeenCalledTimes(1)
    expect(mocks.createWidget.mock.calls[0][0].options).toEqual({
      position: { col: 0, row: 0, sizeX: 3, sizeY: 8 },
      parameterMappings: PINNED_MAPPINGS,
    })
  })

  it('pins them too when the proposal is added to the dashboard already open', async () => {
    const onActive = vi.fn()
    render([PREVIEWED], { id: 5, name: 'Ops', widgetCount: 0 }, onActive)
    await userEvent.click(screen.getByRole('button', { name: /Add to Ops/ }))
    await waitFor(() => expect(onActive).toHaveBeenCalled())
    expect(mocks.createWidget.mock.calls[0][0]).toMatchObject({
      dashboard_id: 5,
      options: { parameterMappings: PINNED_MAPPINGS },
    })
  })

  it('leaves the mappings out when the chat gave no values, so the query keeps its saved defaults', async () => {
    const onActive = vi.fn()
    render([{ kind: 'existing', queryId: 137, visualizationId: 240 }], null, onActive)
    await userEvent.click(screen.getByRole('button', { name: 'Save as new dashboard' }))
    await waitFor(() => expect(onActive).toHaveBeenCalled())
    expect(mocks.createWidget.mock.calls[0][0].options).toEqual({ position: { col: 0, row: 0, sizeX: 3, sizeY: 8 } })
  })
})
