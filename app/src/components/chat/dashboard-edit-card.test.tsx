import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DashboardEditPayload } from '@/lib/chat/dashboard-changes'
import type { DashboardEditDraftView, DraftView } from '@/lib/chat/thread-model'
import { querySync } from '@/test/query-sync'
import { renderWithProviders } from '@/test/utils'
import { DashboardEditActions } from './dashboard-edit-actions'
import { DashboardEditCard } from './dashboard-edit-card'

const apply = vi.hoisted(() => ({ applyDashboardEdit: vi.fn() }))
const chat = vi.hoisted(() => ({ patchPromotion: vi.fn() }))
vi.mock('@/lib/chat/dashboard-edit-apply', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/chat/dashboard-edit-apply')>()),
  ...apply,
}))
vi.mock('@/lib/chat/transport', () => ({ browserTransport: { get: vi.fn(), post: vi.fn(), del: vi.fn() } }))
vi.mock('@/services/ai/chat-client', () => chat)
vi.mock('@/components/chat/proposal-kit/use-write-proposed-query', () => ({
  useWriteProposedQuery: () => ({ write: vi.fn(), isPending: false }),
}))

const POSITION = { col: 0, row: 0, sizeX: 3, sizeY: 8 }

const FULL: DashboardEditPayload = {
  dashboardId: 4,
  snapshot: {
    name: 'Ops',
    tags: ['ops'],
    version: 3,
    updatedAt: 'u',
    widgets: [
      { widgetId: 1, kind: 'visualization', title: 'Trips · Line', position: POSITION, updatedAt: 'U1' },
      { widgetId: 2, kind: 'text', title: '## Notes', position: { col: 3, row: 0, sizeX: 3, sizeY: 4 }, updatedAt: 'U2' },
    ],
  },
  name: 'Operations',
  tags: ['ops', 'daily'],
  operations: [
    { op: 'add', queryId: 7, visualizationId: 70, title: 'Rides · Bars', position: { col: 0, row: 8, sizeX: 3, sizeY: 6 } },
    { op: 'addText', text: 'Footer line\nsecond', position: { col: 0, row: 14, sizeX: 6, sizeY: 4 } },
    { op: 'editText', widgetId: 2, title: '## Notes', updatedAt: 'U2', text: 'Fresh notes', position: { col: 3, row: 0, sizeX: 3, sizeY: 4 } },
    { op: 'move', widgetId: 1, title: 'Trips · Line', updatedAt: 'U1', position: { col: 3, row: 4, sizeX: 3, sizeY: 6 } },
    { op: 'remove', widgetId: 2, title: '## Notes', updatedAt: 'U2', position: { col: 3, row: 0, sizeX: 3, sizeY: 4 } },
  ],
}

function draft(payload: DashboardEditPayload = FULL, promotions: DashboardEditDraftView['promotions'] = []): DashboardEditDraftView {
  return { id: 'd1', versions: [{ version: 1, payload }], promotions }
}

function removeOnly(): DashboardEditPayload {
  return { ...FULL, name: undefined, tags: undefined, operations: [FULL.operations[4]] }
}

const NO_DRAFTS: Record<string, DraftView> = {}

beforeEach(() => vi.clearAllMocks())

describe('DashboardEditCard', () => {
  it('shows one row per change in plain words, with removals marked', () => {
    renderWithProviders(<DashboardEditCard draft={draft()} version={1} queryDrafts={NO_DRAFTS} />)
    expect(screen.getByRole('link', { name: 'Ops' })).toHaveAttribute('href', '/dashboards/4')
    expect(screen.getByText('Add Rides · Bars at col 0, row 8')).toBeInTheDocument()
    expect(screen.getByText('Add text: Footer line')).toBeInTheDocument()
    expect(screen.getByText('Fresh notes')).toBeInTheDocument()
    expect(screen.getByText('Move Trips · Line to col 3, row 4, 3 by 6')).toBeInTheDocument()
    const removal = screen.getByText('Remove ## Notes')
    expect(removal).toHaveClass('text-destructive')
    expect(screen.getByText('Operations')).toBeInTheDocument()
    expect(screen.getByText('ops, daily')).toBeInTheDocument()
  })

  it('names a query draft by its proposal', () => {
    const op = { op: 'add', queryDraftId: 'qd1', title: 'New chart', position: POSITION } as const
    const queryDrafts: Record<string, DraftView> = {
      qd1: {
        id: 'qd1',
        versions: [{ version: 1, payload: { name: 'Speed by hour', description: '', sql: 'x', dataSourceId: 1, vizChoiceId: 'table', vizOptions: {} } }],
        promotions: [],
      },
    }
    renderWithProviders(
      <DashboardEditCard draft={draft({ ...FULL, name: undefined, tags: undefined, operations: [op] })} version={1} queryDrafts={queryDrafts} />
    )
    expect(screen.getByText('Add Speed by hour at col 0, row 0')).toBeInTheDocument()
  })
})

describe('DashboardEditActions', () => {
  function actions(view: DashboardEditDraftView, onApplied = vi.fn()) {
    return renderWithProviders(
      <DashboardEditActions
        draft={view}
        version={1}
        queryDrafts={NO_DRAFTS}
        onQueryPromoted={vi.fn()}
        querySync={querySync()}
        onApplied={onApplied}
        onDashboardActive={vi.fn()}
      />
    )
  }

  it('applies on one click when nothing is removed', async () => {
    const promotion = { id: 'p1', status: 'done', targetId: '4' }
    apply.applyDashboardEdit.mockResolvedValue({ status: 'done', promotion, dashboard: { id: 4, name: 'Ops', widgetCount: 1 } })
    const onApplied = vi.fn()
    actions(draft({ ...FULL, operations: FULL.operations.slice(0, 2) }), onApplied)
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await vi.waitFor(() => expect(onApplied).toHaveBeenCalledWith('d1', promotion))
    expect(apply.applyDashboardEdit.mock.calls[0][3]).toMatchObject({ overwrite: false, confirmRemovals: true })
  })

  it('runs nothing on the first click when widgets are removed, and names them in a confirm', async () => {
    actions(draft(removeOnly()))
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(apply.applyDashboardEdit).not.toHaveBeenCalled()
    expect(screen.getByText(/Remove 1 widget\? ## Notes will be deleted/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(apply.applyDashboardEdit).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument()
  })

  it('applies with removals confirmed only after the second click', async () => {
    apply.applyDashboardEdit.mockResolvedValue({ status: 'done', promotion: { id: 'p1', status: 'done', targetId: '4' }, dashboard: null })
    actions(draft(removeOnly()))
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove and apply' }))
    await vi.waitFor(() => expect(apply.applyDashboardEdit).toHaveBeenCalledTimes(1))
    expect(apply.applyDashboardEdit.mock.calls[0][3]).toMatchObject({ overwrite: false, confirmRemovals: true })
  })

  it('offers overwrite after a conflict, then resends without the precondition', async () => {
    apply.applyDashboardEdit.mockResolvedValueOnce({ status: 'conflict' })
    actions(draft({ ...FULL, operations: [FULL.operations[2]] }))
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(await screen.findByRole('button', { name: 'Overwrite' })).toBeInTheDocument()
    apply.applyDashboardEdit.mockResolvedValueOnce({ status: 'done', promotion: { id: 'p2', status: 'done', targetId: '4' }, dashboard: null })
    await userEvent.click(screen.getByRole('button', { name: 'Overwrite' }))
    await vi.waitFor(() => expect(apply.applyDashboardEdit.mock.calls[1][3]).toMatchObject({ overwrite: true }))
  })

  it('links to the dashboard once applied, with no Apply button', () => {
    const done = [{ id: 'p1', status: 'done', targetId: '4', promotedVersion: 1, receipts: [] }] as unknown as DashboardEditDraftView['promotions']
    actions(draft(FULL, done))
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
    expect(screen.getByRole('link', { name: /Open dashboard/ })).toHaveAttribute('href', '/dashboards/4')
  })

  it('keeps Apply after a partial run and says how far it got', () => {
    const partial = [
      {
        id: 'p1',
        status: 'partial',
        targetId: '4',
        promotedVersion: 1,
        receipts: [
          { step: 0, outcome: 'skipped' },
          { step: 1, outcome: 'done' },
          { step: 2, outcome: 'failed', error: 'boom' },
        ],
      },
    ] as unknown as DashboardEditDraftView['promotions']
    actions(draft({ ...FULL, name: undefined, tags: undefined, operations: FULL.operations.slice(0, 3) }, partial))
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument()
    expect(screen.getByText('1 of 3 changes applied. Apply again to finish the rest.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open dashboard/ })).toBeInTheDocument()
  })

  it('says the save happened and retries only the record when it did not sync', async () => {
    const patch = { status: 'done', targetId: '4', receipts: [] }
    const local = { id: 'p1', status: 'done', targetId: '4' }
    apply.applyDashboardEdit.mockResolvedValue({ status: 'unsynced', promotion: local, patch, dashboard: null })
    chat.patchPromotion.mockResolvedValue(local)
    const onApplied = vi.fn()
    actions(draft({ ...FULL, operations: [FULL.operations[1]] }), onApplied)
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(await screen.findByText('Saved, but the record of it did not save.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await vi.waitFor(() => expect(onApplied).toHaveBeenCalledWith('d1', local))
    expect(apply.applyDashboardEdit).toHaveBeenCalledTimes(1)
  })
})
