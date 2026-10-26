import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActiveDashboard, DashboardDraftView } from '@/lib/chat/thread-model'
import type { ChatPromotion } from '@/lib/chat/wire'
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
  items: [{ kind: 'existing' as const, queryId: 12, visualizationId: 31 }],
}

function promotion(overrides: Partial<ChatPromotion> = {}): ChatPromotion {
  return {
    id: 'p1',
    targetType: 'dashboard',
    targetId: '9',
    promotedVersion: 1,
    targetVersionAtPromote: 1,
    status: 'done',
    receipts: [],
    createdAt: 'x',
    updatedAt: 'x',
    ...overrides,
  }
}

function draft(overrides: Partial<DashboardDraftView> = {}): DashboardDraftView {
  return { id: 'dd1', versions: [{ version: 1, payload: PAYLOAD }], promotions: [], ...overrides }
}

function render(view: DashboardDraftView, active: ActiveDashboard | null = null) {
  return renderWithProviders(
    <DashboardDraftActions
      draft={view}
      queryDrafts={{}}
      activeDashboard={active}
      onQueryPromoted={vi.fn()}
      querySync={querySync()}
      onDashboardPromoted={vi.fn()}
      onDashboardActive={vi.fn()}
    />
  )
}

function StatefulCard() {
  const [view, setView] = useState(draft())
  const [active, setActive] = useState<ActiveDashboard | null>(null)
  return (
    <DashboardDraftActions
      draft={view}
      queryDrafts={{}}
      activeDashboard={active}
      onQueryPromoted={vi.fn()}
      querySync={querySync()}
      onDashboardPromoted={(_id, saved) => setView((current) => ({ ...current, promotions: [saved] }))}
      onDashboardActive={setActive}
    />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.queriesGet.mockResolvedValue({ id: 12, visualizations: [{ id: 31, type: 'CHART' }] })
  mocks.dashboardsCreate.mockResolvedValue({ id: 9, name: 'Overview' })
  mocks.dashboardsGet.mockResolvedValue({ id: 4, name: 'Other board', widgets: [] })
  mocks.createWidget.mockResolvedValue({ id: 301, updated_at: 'w' })
  mocks.recordPromotion.mockImplementation(async (_d: string, body: Record<string, unknown>) =>
    promotion({ status: 'pending', targetId: null, promotedVersion: body.version as number })
  )
  mocks.patchPromotion.mockImplementation(async (_d: string, _id: string, patch: Record<string, unknown>) =>
    promotion(patch as Partial<ChatPromotion>)
  )
})

describe('DashboardDraftActions: a version that has been saved', () => {
  it('no longer offers Save as new dashboard, and offers Open dashboard', () => {
    render(draft({ promotions: [promotion()] }))
    expect(screen.queryByRole('button', { name: 'Save as new dashboard' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open dashboard' })).toHaveAttribute('href', '/dashboards/9')
  })

  it('offers Save as new dashboard again once the draft has a newer version', () => {
    const versions = [
      { version: 1, payload: PAYLOAD },
      { version: 2, payload: PAYLOAD },
    ]
    render(draft({ versions, promotions: [promotion()] }))
    expect(screen.getByRole('button', { name: 'Save as new dashboard' })).toBeEnabled()
  })

  it('does not offer Add to the dashboard the version was saved to', () => {
    render(draft({ promotions: [promotion()] }), { id: 9, name: 'Overview', widgetCount: 1 })
    expect(screen.queryByRole('button', { name: 'Save as new dashboard' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add to Overview' })).not.toBeInTheDocument()
  })

  it('still offers Add to a different open dashboard', () => {
    render(draft({ promotions: [promotion()] }), { id: 4, name: 'Other board', widgetCount: 1 })
    expect(screen.getByRole('button', { name: 'Add to Other board' })).toBeEnabled()
  })

  it('swaps the actions for Open dashboard after the first save lands', async () => {
    renderWithProviders(<StatefulCard />)
    await userEvent.click(screen.getByRole('button', { name: 'Save as new dashboard' }))
    await waitFor(() => expect(screen.getByRole('link', { name: 'Open dashboard' })).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Save as new dashboard' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add to Overview' })).not.toBeInTheDocument()
    expect(mocks.dashboardsCreate).toHaveBeenCalledTimes(1)
  })
})

describe('DashboardDraftActions: a second click while a save is in flight', () => {
  it('starts one save, not two', async () => {
    render(draft())
    const button = screen.getByRole('button', { name: 'Save as new dashboard' })
    act(() => {
      button.click()
      button.click()
    })
    await waitFor(() => expect(mocks.dashboardsCreate).toHaveBeenCalled())
    expect(mocks.recordPromotion).toHaveBeenCalledTimes(1)
    expect(mocks.dashboardsCreate).toHaveBeenCalledTimes(1)
  })

  it('starts one append, not two', async () => {
    render(draft(), { id: 4, name: 'Other board', widgetCount: 0 })
    const button = screen.getByRole('button', { name: 'Add to Other board' })
    act(() => {
      button.click()
      button.click()
    })
    await waitFor(() => expect(mocks.createWidget).toHaveBeenCalled())
    expect(mocks.recordPromotion).toHaveBeenCalledTimes(1)
  })
})
