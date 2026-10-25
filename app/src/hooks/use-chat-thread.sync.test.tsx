import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lastApplied } from '@/lib/chat/promotions'
import type { ChatPromotion } from '@/lib/chat/wire'
import { FakeEventSource } from '@/test/fake-event-source'
import { useChatThread } from './use-chat-thread'

const client = vi.hoisted(() => ({
  getThread: vi.fn(),
  postTurn: vi.fn(),
  postToolResult: vi.fn(),
  cancelTurn: vi.fn(),
  patchPromotion: vi.fn(),
}))

vi.mock('@/services/ai/chat-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/ai/chat-client')>()),
  ...client,
}))

const THREAD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const STAMP = '2026-10-25T00:00:00Z'
const PAYLOAD = { name: 'Trips', description: '', sql: 'SELECT 1', dataSourceId: 5, vizChoiceId: 'table', vizOptions: {} }

const PENDING: ChatPromotion = {
  id: 'p1',
  targetType: 'query',
  targetId: null,
  promotedVersion: 1,
  targetVersionAtPromote: null,
  status: 'pending',
  receipts: [],
  createdAt: STAMP,
  updatedAt: STAMP,
}
const PATCH = { status: 'done' as const, targetId: '44', receipts: [{ step: 0, outcome: 'done' as const, targetId: '44' }] }
const HELD = { promotion: { ...PENDING, ...PATCH }, patch: PATCH }
const NEWER: ChatPromotion = { ...PENDING, id: 'p2', status: 'done', targetId: '45', receipts: [] }

function detail(promotions: ChatPromotion[] = []) {
  return {
    thread: { id: THREAD, title: '', pinned: false, createdAt: STAMP, updatedAt: STAMP, lastTurnAt: STAMP, origin: 'chat' },
    turns: [],
    drafts: [{ id: 'q1', kind: 'query', versions: [{ version: 1, payload: PAYLOAD }], promotions }],
  }
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

async function mounted() {
  const hook = renderHook(() => useChatThread(THREAD), { wrapper })
  await waitFor(() => expect(hook.result.current.loading).toBe(false))
  return hook
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

beforeEach(() => {
  FakeEventSource.reset()
  vi.stubGlobal('EventSource', FakeEventSource)
  client.getThread.mockResolvedValue(detail())
  client.patchPromotion.mockImplementation(async (_draft: string, id: string, patch: object) => ({
    ...PENDING,
    ...patch,
    id,
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('useChatThread query draft sync', () => {
  it('holds a query draft whose record did not save, for every card in the thread', async () => {
    const { result } = await mounted()
    act(() => result.current.holdQueryDraftSync('q1', HELD))
    expect(result.current.state.queryDraftSync.q1).toEqual(HELD)
    expect(result.current.state.drafts.q1?.promotions).toEqual([])
  })

  it('a retry patches the held record once, records it and clears the hold', async () => {
    const { result } = await mounted()
    act(() => result.current.holdQueryDraftSync('q1', HELD))
    let synced: ChatPromotion | null = null
    await act(async () => {
      synced = await result.current.retryQueryDraftSync('q1')
    })
    expect(client.patchPromotion).toHaveBeenCalledWith('q1', 'p1', PATCH)
    expect(synced).toEqual(expect.objectContaining({ id: 'p1', status: 'done', targetId: '44' }))
    expect(result.current.state.queryDraftSync.q1).toBeUndefined()
    expect(lastApplied(result.current.state.drafts.q1?.promotions ?? [])?.targetId).toBe('44')
  })

  it('a failed retry keeps the hold', async () => {
    client.patchPromotion.mockRejectedValueOnce(new Error('sidecar down'))
    const { result } = await mounted()
    act(() => result.current.holdQueryDraftSync('q1', HELD))
    await act(async () => {
      expect(await result.current.retryQueryDraftSync('q1')).toBeNull()
    })
    expect(result.current.state.queryDraftSync.q1).toEqual(HELD)
  })

  it('two retries at once send one PATCH', async () => {
    const gate = deferred<ChatPromotion>()
    client.patchPromotion.mockReturnValueOnce(gate.promise)
    const { result } = await mounted()
    act(() => result.current.holdQueryDraftSync('q1', HELD))
    let first: Promise<ChatPromotion | null> = Promise.resolve(null)
    let second: Promise<ChatPromotion | null> = Promise.resolve(null)
    act(() => {
      first = result.current.retryQueryDraftSync('q1')
      second = result.current.retryQueryDraftSync('q1')
    })
    await act(async () => {
      gate.resolve({ ...HELD.promotion })
      await Promise.all([first, second])
    })
    expect(client.patchPromotion).toHaveBeenCalledTimes(1)
    expect(result.current.state.queryDraftSync.q1).toBeUndefined()
  })

  it('a promotion of the held record from any card clears the hold', async () => {
    const { result } = await mounted()
    act(() => result.current.holdQueryDraftSync('q1', HELD))
    act(() => result.current.promoted('q1', { ...HELD.promotion }))
    expect(result.current.state.queryDraftSync.q1).toBeUndefined()
  })

  it('a stale retry completion cannot overwrite a newer done promotion', async () => {
    const gate = deferred<ChatPromotion>()
    client.patchPromotion.mockReturnValueOnce(gate.promise)
    const { result } = await mounted()
    act(() => result.current.holdQueryDraftSync('q1', HELD))
    let retry: Promise<ChatPromotion | null> = Promise.resolve(null)
    act(() => {
      retry = result.current.retryQueryDraftSync('q1')
    })
    act(() => result.current.promoted('q1', NEWER))
    expect(result.current.state.queryDraftSync.q1).toBeUndefined()
    let outcome: ChatPromotion | null = null
    await act(async () => {
      gate.resolve({ ...HELD.promotion })
      outcome = await retry
    })
    expect(outcome).toBeNull()
    expect(lastApplied(result.current.state.drafts.q1?.promotions ?? [])?.id).toBe('p2')
  })

  it('a stale retry completion does not clear a newer hold', async () => {
    const gate = deferred<ChatPromotion>()
    client.patchPromotion.mockReturnValueOnce(gate.promise)
    const { result } = await mounted()
    act(() => result.current.holdQueryDraftSync('q1', HELD))
    let retry: Promise<ChatPromotion | null> = Promise.resolve(null)
    act(() => {
      retry = result.current.retryQueryDraftSync('q1')
    })
    const later = { promotion: { ...HELD.promotion, id: 'p3' }, patch: PATCH }
    act(() => result.current.holdQueryDraftSync('q1', later))
    await act(async () => {
      gate.resolve({ ...HELD.promotion })
      await retry
    })
    expect(result.current.state.queryDraftSync.q1).toEqual(later)
  })

  it('a hold survives the thread reloading from the server', async () => {
    const { result } = await mounted()
    act(() => result.current.holdQueryDraftSync('q1', HELD))
    client.getThread.mockResolvedValue(detail([PENDING]))
    act(() => result.current.reload())
    await waitFor(() => expect(client.getThread).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.state.queryDraftSync.q1).toEqual(HELD)
  })

  it('a reload that shows the held record settled drops the hold', async () => {
    const { result } = await mounted()
    act(() => result.current.holdQueryDraftSync('q1', HELD))
    client.getThread.mockResolvedValue(detail([{ ...HELD.promotion }]))
    act(() => result.current.reload())
    await waitFor(() => expect(client.getThread).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.state.queryDraftSync.q1).toBeUndefined())
  })
})
