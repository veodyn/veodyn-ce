import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/services/api-client'
import type { DashboardOperation } from './dashboard-changes'
import { applyDashboardEdit, CONFIRM_REMOVALS } from './dashboard-edit-apply'
import {
  draftFor,
  pending,
  POSITION,
  rawDashboard,
  rawWidget,
  SAVED_STAMP,
  SNAPSHOT_STAMP,
  target,
  transportFor,
} from './dashboard-edit-apply.fixtures'

const chat = vi.hoisted(() => ({ recordPromotion: vi.fn(), patchPromotion: vi.fn() }))
vi.mock('@/services/ai/chat-client', () => chat)

const open = { overwrite: false, confirmRemovals: true }

beforeEach(() => {
  chat.recordPromotion.mockReset().mockResolvedValue(pending)
  chat.patchPromotion.mockReset().mockImplementation(async (_d: string, _p: string, patch: object) => ({ ...pending, ...patch }))
})

describe('applyDashboardEdit: one widget at a time', () => {
  it('writes only the edited widget, with its freshly fetched full options', async () => {
    const transport = transportFor()
    const op = target('editText', 2, { text: 'new text' })
    const outcome = await applyDashboardEdit(draftFor([op]), 1, transport, open)
    expect(outcome.status).toBe('done')
    const writes = transport.calls.filter((call) => !call.startsWith('GET'))
    expect(writes).toEqual(['POST widgets/2'])
    expect(transport.post).toHaveBeenCalledWith(
      'widgets/2',
      {
        text: 'new text',
        width: 1,
        options: { position: { ...POSITION, autoHeight: false }, isHidden: false, extraKey: 'keep-2' },
        expected_updated_at: 'snap-2',
      },
      undefined
    )
  })

  it('moves a widget by changing only the position fields the operation gives', async () => {
    const transport = transportFor()
    const op = target('move', 1, { position: { col: 3, row: 9, sizeX: 3, sizeY: 6 } })
    await applyDashboardEdit(draftFor([op]), 1, transport, open)
    expect(transport.post).toHaveBeenCalledWith(
      'widgets/1',
      {
        text: '',
        width: 1,
        options: {
          position: { col: 3, row: 9, sizeX: 3, sizeY: 6, autoHeight: false },
          isHidden: false,
          extraKey: 'keep-1',
        },
        expected_updated_at: 'snap-1',
      },
      undefined
    )
    expect(transport.post).toHaveBeenCalledTimes(1)
  })

  it('removes with the precondition as a query parameter', async () => {
    const transport = transportFor()
    await applyDashboardEdit(draftFor([target('remove', 3)]), 1, transport, open)
    expect(transport.del).toHaveBeenCalledWith('widgets/3', { expected_updated_at: 'snap-3' }, undefined)
  })
})

describe('applyDashboardEdit: removals need the second click', () => {
  it('runs nothing and records nothing when removals are not confirmed', async () => {
    const transport = transportFor()
    const draft = draftFor([target('editText', 2, { text: 'x' }), target('remove', 3)])
    const outcome = await applyDashboardEdit(draft, 1, transport, { overwrite: false, confirmRemovals: false })
    expect(outcome).toEqual({ status: 'failed', error: CONFIRM_REMOVALS })
    expect(transport.calls).toEqual([])
    expect(chat.recordPromotion).not.toHaveBeenCalled()
  })

  it('needs no confirmation when nothing is removed', async () => {
    const transport = transportFor()
    const outcome = await applyDashboardEdit(draftFor([target('editText', 2, { text: 'x' })]), 1, transport, {
      overwrite: false,
      confirmRemovals: false,
    })
    expect(outcome.status).toBe('done')
  })
})

describe('applyDashboardEdit: adds, text and the dashboard step', () => {
  const add: DashboardOperation = {
    op: 'add',
    queryId: 7,
    visualizationId: 70,
    title: 'Trips · Line',
    position: { col: 0, row: 8, sizeX: 3, sizeY: 6 },
    parameterMappings: { start: { type: 'widget-level', mapTo: 'start', value: null, title: 'Start' } },
  }
  const addText: DashboardOperation = { op: 'addText', text: 'Footer', position: { col: 0, row: 14, sizeX: 6, sizeY: 4 } }

  it('renames and retags first with the dashboard precondition, then creates widgets with stable keys', async () => {
    const transport = transportFor()
    await applyDashboardEdit(draftFor([add, addText], { name: 'Operations', tags: ['ops'] }), 1, transport, open)
    expect(transport.calls.filter((call) => !call.startsWith('GET'))).toEqual([
      'POST dashboards/4',
      'POST widgets',
      'POST widgets',
    ])
    expect(transport.post).toHaveBeenNthCalledWith(
      1,
      'dashboards/4',
      { name: 'Operations', tags: ['ops'], expected_updated_at: SNAPSHOT_STAMP },
      undefined
    )
    expect(transport.post).toHaveBeenNthCalledWith(
      2,
      'widgets',
      {
        dashboard_id: 4,
        visualization_id: 70,
        text: '',
        width: 1,
        options: {
          isHidden: false,
          position: { autoHeight: false, col: 0, row: 8, sizeX: 3, sizeY: 6 },
          parameterMappings: add.op === 'add' ? add.parameterMappings : undefined,
        },
        idempotency_key: 'd1:1:d4:1',
      },
      undefined
    )
    expect(transport.post).toHaveBeenNthCalledWith(
      3,
      'widgets',
      expect.objectContaining({ visualization_id: null, text: 'Footer', idempotency_key: 'd1:1:d4:2' }),
      undefined
    )
  })

  it('does not touch the dashboard row when only widgets change', async () => {
    const transport = transportFor()
    await applyDashboardEdit(draftFor([addText]), 1, transport, open)
    expect(transport.post).not.toHaveBeenCalledWith('dashboards/4', expect.anything(), undefined)
  })

  it('promotes a query draft first, then adds its chart', async () => {
    const promoteDraft = vi.fn(async () => ({ queryId: 55, visualizationId: 550 }))
    const transport = transportFor()
    const op: DashboardOperation = { op: 'add', queryDraftId: 'qd-1', title: 'New chart', position: { col: 0, row: 8, sizeX: 3, sizeY: 6 } }
    const outcome = await applyDashboardEdit(draftFor([op]), 1, transport, { ...open, promoteDraft })
    expect(promoteDraft).toHaveBeenCalledWith('qd-1')
    expect(transport.post).toHaveBeenCalledWith('widgets', expect.objectContaining({ visualization_id: 550 }), undefined)
    expect(outcome.status).toBe('done')
  })

  it('fails the step when the query draft cannot be promoted', async () => {
    const op: DashboardOperation = { op: 'add', queryDraftId: 'qd-1', title: 'New chart', position: { col: 0, row: 8, sizeX: 3, sizeY: 6 } }
    const outcome = await applyDashboardEdit(draftFor([op]), 1, transportFor(), { ...open, promoteDraft: async () => null })
    expect(outcome).toMatchObject({ status: 'failed' })
  })
})

describe('applyDashboardEdit: conflicts and partial runs', () => {
  const conflict = (path: string) => (path === 'widgets/2' ? new ApiError(409, 'changed') : undefined)

  it('answers conflict when a widget changed since the card, and runs nothing after it', async () => {
    const transport = transportFor({ failOn: conflict })
    const ops = [target('editText', 2, { text: 'x' }), target('remove', 3)]
    const outcome = await applyDashboardEdit(draftFor(ops), 1, transport, open)
    expect(outcome).toMatchObject({ status: 'conflict' })
    expect(transport.del).not.toHaveBeenCalled()
    expect(chat.patchPromotion).toHaveBeenLastCalledWith('d1', 'p1', {
      status: 'failed',
      receipts: [expect.objectContaining({ step: 0, outcome: 'skipped' }), expect.objectContaining({ step: 1, outcome: 'failed' })],
    })
  })

  it('sends no precondition when the analyst chose to overwrite', async () => {
    const transport = transportFor()
    await applyDashboardEdit(draftFor([target('editText', 2, { text: 'x' }), target('remove', 3)], { name: 'N' }), 1, transport, {
      overwrite: true,
      confirmRemovals: true,
    })
    expect(transport.post.mock.calls.every(([, body]) => !('expected_updated_at' in (body as object)))).toBe(true)
    expect(transport.del).toHaveBeenCalledWith('widgets/3', undefined, undefined)
  })

  it('records the steps that landed as receipts when a later step fails', async () => {
    const transport = transportFor({ failOn: (path) => (path === 'widgets/3' ? new ApiError(500, 'boom') : undefined) })
    const ops = [target('move', 1, { position: { col: 1, row: 0, sizeX: 2, sizeY: 2 } }), target('remove', 3)]
    const outcome = await applyDashboardEdit(draftFor(ops), 1, transport, open)
    expect(outcome).toMatchObject({ status: 'failed', error: 'boom' })
    expect(chat.patchPromotion).toHaveBeenLastCalledWith('d1', 'p1', {
      status: 'partial',
      targetId: '4',
      receipts: [
        { step: 0, outcome: 'skipped', targetId: '4' },
        { step: 1, outcome: 'done', targetId: '1', updatedAt: SAVED_STAMP },
        { step: 2, outcome: 'failed', error: 'boom' },
      ],
    })
  })

  it('resumes after a partial run without repeating the steps that landed', async () => {
    const earlier = {
      ...pending,
      id: 'p0',
      status: 'partial' as const,
      receipts: [
        { step: 0, outcome: 'skipped' as const, targetId: '4' },
        { step: 1, outcome: 'done' as const, targetId: '1', updatedAt: 'T1' },
        { step: 2, outcome: 'failed' as const, error: 'boom' },
      ],
    }
    const transport = transportFor()
    const ops = [target('move', 1, { position: { col: 1, row: 0, sizeX: 2, sizeY: 2 } }), target('remove', 3)]
    const outcome = await applyDashboardEdit(draftFor(ops, {}, [earlier]), 1, transport, open)
    expect(outcome.status).toBe('done')
    expect(transport.calls.filter((call) => !call.startsWith('GET'))).toEqual(['DELETE widgets/3'])
    expect(chat.patchPromotion).toHaveBeenLastCalledWith(
      'd1',
      'p1',
      expect.objectContaining({
        status: 'done',
        receipts: [
          { step: 0, outcome: 'skipped', targetId: '4' },
          { step: 1, outcome: 'done', targetId: '1', updatedAt: 'T1' },
          expect.objectContaining({ step: 2, outcome: 'done', targetId: '3' }),
        ],
      })
    )
  })

  it('answers failed when the target widget is gone from the fresh read', async () => {
    const transport = transportFor({ board: rawDashboard([rawWidget(1)]) })
    const outcome = await applyDashboardEdit(draftFor([target('editText', 2, { text: 'x' })]), 1, transport, open)
    expect(outcome.status).toBe('failed')
    expect(transport.post).not.toHaveBeenCalled()
  })
})

describe('applyDashboardEdit: the promotion record', () => {
  it('creates the pending promotion first and finishes it with the chart count, text excluded', async () => {
    const order: string[] = []
    chat.recordPromotion.mockImplementation(async () => {
      order.push('record')
      return pending
    })
    const transport = transportFor()
    transport.post.mockImplementation(async () => {
      order.push('write')
      return { id: 900, updated_at: SAVED_STAMP }
    })
    const outcome = await applyDashboardEdit(draftFor([target('move', 1, { position: { col: 1, row: 0, sizeX: 2, sizeY: 2 } })]), 1, transport, open)
    expect(order).toEqual(['record', 'write'])
    expect(chat.recordPromotion).toHaveBeenCalledWith('d1', {
      version: 1,
      targetType: 'dashboard',
      targetId: '4',
      status: 'pending',
    })
    expect(chat.patchPromotion).toHaveBeenLastCalledWith(
      'd1',
      'p1',
      expect.objectContaining({ status: 'done', targetId: '4', targetVersionAtPromote: 2 })
    )
    expect(outcome).toMatchObject({ status: 'done', dashboard: { id: 4, name: 'Ops', widgetCount: 2 } })
  })

  it('reports unsynced when the dashboard was written but the promotion record was not', async () => {
    chat.patchPromotion.mockRejectedValue(new Error('sidecar down'))
    const outcome = await applyDashboardEdit(draftFor([target('remove', 3)]), 1, transportFor(), open)
    expect(outcome).toMatchObject({ status: 'unsynced', patch: { status: 'done', targetId: '4' } })
  })

  it('writes nothing when the pending promotion cannot be recorded', async () => {
    chat.recordPromotion.mockRejectedValue(new Error('offline'))
    const transport = transportFor()
    const outcome = await applyDashboardEdit(draftFor([target('remove', 3)]), 1, transport, open)
    expect(outcome.status).toBe('failed')
    expect(transport.del).not.toHaveBeenCalled()
  })
})
