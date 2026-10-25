import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { VizDraft } from '@/lib/chat/viz-apply'
import { useApplyVizChange } from './use-apply-viz-change'

const apply = vi.hoisted(() => ({ applyVizChange: vi.fn() }))
const chat = vi.hoisted(() => ({ patchPromotion: vi.fn() }))
vi.mock('@/lib/chat/viz-apply', () => apply)
vi.mock('@/lib/chat/transport', () => ({ browserTransport: {} }))
vi.mock('@/services/ai/chat-client', () => chat)

const DRAFT: VizDraft = {
  id: 'd1',
  versions: [{ version: 1, payload: { mode: 'new', queryId: 5, next: { type: 'CHART', name: 'x', options: {} } } }],
  promotions: [],
}

function mount(onApplied = vi.fn()) {
  const client = new QueryClient()
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const hook = renderHook(() => useApplyVizChange(DRAFT, 1, onApplied), { wrapper })
  return { ...hook, onApplied, invalidate }
}

beforeEach(() => vi.clearAllMocks())

describe('useApplyVizChange', () => {
  it('reports the promotion and refreshes the query and dashboards when the change lands', async () => {
    const promotion = { id: 'p1', status: 'done' }
    apply.applyVizChange.mockResolvedValue({ status: 'done', promotion })
    const { result, onApplied, invalidate } = mount()
    act(() => result.current.apply(false))
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith('d1', promotion))
    expect(apply.applyVizChange.mock.calls[0][3]).toEqual({ overwrite: false })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['query', 5] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['dashboards'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['dashboard'] })
  })

  it('enters the conflict state, and overwrite resends with overwrite true', async () => {
    apply.applyVizChange.mockResolvedValueOnce({ status: 'conflict' })
    const { result } = mount()
    act(() => result.current.apply(false))
    await waitFor(() => expect(result.current.status).toBe('conflict'))
    apply.applyVizChange.mockResolvedValueOnce({ status: 'done', promotion: { id: 'p2' } })
    act(() => result.current.apply(true))
    await waitFor(() => expect(result.current.status).toBe('idle'))
    expect(apply.applyVizChange.mock.calls[1][3]).toEqual({ overwrite: true })
  })

  it('shows a failure and reports nothing', async () => {
    apply.applyVizChange.mockResolvedValue({ status: 'failed', error: 'Forbidden' })
    const { result, onApplied } = mount()
    act(() => result.current.apply(false))
    await waitFor(() => expect(result.current.error).toBe('Forbidden'))
    expect(onApplied).not.toHaveBeenCalled()
  })

  it('holds an unsynced save, and Retry re-sends only the record', async () => {
    const promotion = { id: 'p1', status: 'done' }
    const patch = { status: 'done', targetId: '5' }
    apply.applyVizChange.mockResolvedValue({ status: 'unsynced', promotion, patch })
    chat.patchPromotion.mockResolvedValue({ ...promotion, updatedAt: 'synced' })
    const { result, onApplied } = mount()
    act(() => result.current.apply(false))
    await waitFor(() => expect(result.current.status).toBe('unsynced'))
    act(() => result.current.retrySync())
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith('d1', { ...promotion, updatedAt: 'synced' }))
    expect(apply.applyVizChange).toHaveBeenCalledTimes(1)
  })
})
