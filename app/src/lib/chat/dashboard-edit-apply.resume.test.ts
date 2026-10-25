import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/services/api-client'
import type { DashboardOperation } from './dashboard-changes'
import { applyDashboardEdit } from './dashboard-edit-apply'
import { draftFor, pending, target, transportFor } from './dashboard-edit-apply.fixtures'

const chat = vi.hoisted(() => ({ recordPromotion: vi.fn(), patchPromotion: vi.fn() }))
vi.mock('@/services/ai/chat-client', () => chat)

const open = { overwrite: false, confirmRemovals: true }
const add: DashboardOperation = { op: 'add', queryId: 7, visualizationId: 70, title: 'Trips', position: { col: 0, row: 8, sizeX: 3, sizeY: 6 } }

beforeEach(() => {
  chat.recordPromotion.mockReset().mockResolvedValue(pending)
  chat.patchPromotion.mockReset().mockImplementation(async (_d: string, _p: string, patch: object) => ({ ...pending, ...patch }))
})

describe('applyDashboardEdit: the retry after a partial failure', () => {
  it('returns the partial promotion, and a second Apply sends only the step that failed', async () => {
    const first = transportFor({ failOn: (path) => (path === 'widgets' ? new ApiError(500, 'boom') : undefined) })
    const ops = [target('remove', 3), add]
    const failed = await applyDashboardEdit(draftFor(ops), 1, first, open)
    expect(failed).toMatchObject({ status: 'failed', error: 'boom', promotion: { status: 'partial', targetId: '4' } })
    if (failed.status !== 'failed' || !failed.promotion) throw new Error('no promotion')
    expect(first.del).toHaveBeenCalledTimes(1)

    const second = transportFor()
    const outcome = await applyDashboardEdit(draftFor(ops, {}, [failed.promotion]), 1, second, open)
    expect(outcome.status).toBe('done')
    expect(second.calls.filter((call) => !call.startsWith('GET'))).toEqual(['POST widgets'])
  })

  it('returns the partial promotion with a conflict too, so Overwrite skips what landed', async () => {
    const first = transportFor({ failOn: (path) => (path === 'widgets/2' ? new ApiError(409, 'changed') : undefined) })
    const ops = [target('remove', 3), target('editText', 2, { text: 'x' })]
    const conflict = await applyDashboardEdit(draftFor(ops), 1, first, open)
    expect(conflict).toMatchObject({ status: 'conflict', promotion: { status: 'partial' } })
    if (conflict.status !== 'conflict' || !conflict.promotion) throw new Error('no promotion')

    const second = transportFor()
    await applyDashboardEdit(draftFor(ops, {}, [conflict.promotion]), 1, second, { overwrite: true, confirmRemovals: true })
    expect(second.del).not.toHaveBeenCalled()
    expect(second.post).toHaveBeenCalledWith('widgets/2', expect.not.objectContaining({ expected_updated_at: expect.anything() }), undefined)
  })

  it('returns a failed promotion when nothing landed', async () => {
    const first = transportFor({ failOn: () => new ApiError(500, 'boom') })
    const outcome = await applyDashboardEdit(draftFor([add]), 1, first, open)
    expect(outcome).toMatchObject({ status: 'failed', promotion: { status: 'failed' } })
  })
})
