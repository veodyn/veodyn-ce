import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { EditDraft } from '@/lib/chat/query-edit'
import { useApplyQueryEdit } from './use-apply-query-edit'

const apply = vi.hoisted(() => ({ applyQueryEdit: vi.fn() }))
const chat = vi.hoisted(() => ({ patchPromotion: vi.fn() }))
vi.mock('@/lib/chat/query-edit', () => apply)
vi.mock('@/services/ai/chat-client', () => chat)

const DRAFT: EditDraft = {
  id: 'd1',
  versions: [
    {
      version: 1,
      payload: {
        queryId: 5,
        snapshot: {
          id: 5,
          name: 'Trips',
          description: null,
          sql: 'select 1',
          dataSourceId: 2,
          parameters: [],
          tags: [],
          schedule: null,
          isDraft: false,
          updatedAt: 'u',
        },
        changes: { name: 'x' },
      },
    },
  ],
  promotions: [],
}

function mount(onApplied = vi.fn()) {
  const client = new QueryClient()
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const hook = renderHook(() => useApplyQueryEdit(DRAFT, 1, onApplied), { wrapper })
  return { ...hook, onApplied, invalidate }
}

beforeEach(() => vi.clearAllMocks())

describe('useApplyQueryEdit', () => {
  it('reports the promotion and refreshes the query when the edit lands', async () => {
    const promotion = { id: 'p1', status: 'done' }
    apply.applyQueryEdit.mockResolvedValue({ status: 'done', promotion })
    const { result, onApplied, invalidate } = mount()
    act(() => result.current.apply(false))
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith('d1', promotion))
    expect(apply.applyQueryEdit.mock.calls[0][3]).toEqual({ overwrite: false })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['query', 5] })
    expect(result.current.status).toBe('idle')
  })

  it('enters the conflict state, and overwrite resends with overwrite true', async () => {
    apply.applyQueryEdit.mockResolvedValueOnce({ status: 'conflict' })
    const { result } = mount()
    act(() => result.current.apply(false))
    await waitFor(() => expect(result.current.status).toBe('conflict'))

    apply.applyQueryEdit.mockResolvedValueOnce({ status: 'done', promotion: { id: 'p2' } })
    act(() => result.current.apply(true))
    await waitFor(() => expect(result.current.status).toBe('idle'))
    expect(apply.applyQueryEdit.mock.calls[1][3]).toEqual({ overwrite: true })
  })

  it('keeping their changes leaves the conflict state', async () => {
    apply.applyQueryEdit.mockResolvedValue({ status: 'conflict' })
    const { result } = mount()
    act(() => result.current.apply(false))
    await waitFor(() => expect(result.current.status).toBe('conflict'))
    act(() => result.current.keep())
    expect(result.current.status).toBe('idle')
  })

  it('shows the failure and does not report a promotion', async () => {
    apply.applyQueryEdit.mockResolvedValue({ status: 'failed', error: 'Forbidden' })
    const { result, onApplied } = mount()
    act(() => result.current.apply(false))
    await waitFor(() => expect(result.current.error).toBe('Forbidden'))
    expect(onApplied).not.toHaveBeenCalled()
  })

  it('holds an unsynced save, and Retry re-sends only the record', async () => {
    const promotion = { id: 'p1', status: 'done', targetId: '5', receipts: [] }
    const patch = { status: 'done', targetId: '5', receipts: [{ step: 0, outcome: 'done' }] }
    apply.applyQueryEdit.mockResolvedValue({ status: 'unsynced', promotion, patch })
    chat.patchPromotion.mockResolvedValue({ ...promotion, updatedAt: 'synced' })
    const { result, onApplied } = mount()
    act(() => result.current.apply(false))
    await waitFor(() => expect(result.current.status).toBe('unsynced'))
    expect(onApplied).not.toHaveBeenCalled()

    act(() => result.current.retrySync())
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith('d1', { ...promotion, updatedAt: 'synced' }))
    expect(chat.patchPromotion).toHaveBeenCalledWith('d1', 'p1', patch)
    expect(apply.applyQueryEdit).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe('idle')
  })

  it('stays unsynced when the retry fails too', async () => {
    apply.applyQueryEdit.mockResolvedValue({ status: 'unsynced', promotion: { id: 'p1' }, patch: { status: 'done' } })
    chat.patchPromotion.mockRejectedValue(new Error('still down'))
    const { result, onApplied } = mount()
    act(() => result.current.apply(false))
    await waitFor(() => expect(result.current.status).toBe('unsynced'))
    act(() => result.current.retrySync())
    await waitFor(() => expect(chat.patchPromotion).toHaveBeenCalled())
    expect(result.current.status).toBe('unsynced')
    expect(onApplied).not.toHaveBeenCalled()
  })
})
