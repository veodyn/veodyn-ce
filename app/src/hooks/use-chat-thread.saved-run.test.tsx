import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeEventSource } from '@/test/fake-event-source'
import { useChatThread } from './use-chat-thread'

const client = vi.hoisted(() => ({
  getThread: vi.fn(),
  postTurn: vi.fn(),
  postToolResult: vi.fn(),
  cancelTurn: vi.fn(),
}))
const execution = vi.hoisted(() => ({ executeAdhoc: vi.fn(), executeSavedQuery: vi.fn() }))
const queries = vi.hoisted(() => ({ search: vi.fn(), get: vi.fn() }))

vi.mock('@/services/ai/chat-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/ai/chat-client')>()),
  ...client,
}))
vi.mock('@/services/redash/execution', () => execution)
vi.mock('@/services/redash/queries', () => queries)

const THREAD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TURN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const DATA = { columns: [{ name: 'n', type: 'integer', friendly_name: 'n' }], rows: [{ n: 1 }, { n: 2 }] }

function storedTurn(blocks: unknown[]) {
  return {
    id: TURN,
    seq: 1,
    status: 'done',
    userText: 'q',
    stopReason: 'end_turn',
    errorId: null,
    createdAt: 'x',
    finishedAt: 'x',
    blocks,
  }
}

function detail(turns: unknown[]) {
  const stamp = '2026-09-17T00:00:00Z'
  return {
    thread: { id: THREAD, title: '', pinned: false, createdAt: stamp, updatedAt: stamp, lastTurnAt: stamp },
    turns,
    drafts: [],
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

const SAVED_CALL = {
  role: 'assistant',
  content: [
    {
      type: 'tool_use',
      id: 's1',
      name: 'run_saved_query',
      input: { queryId: 137, params: { route: 'R720' }, visualizationId: 1372, purpose: 'Route 720' },
    },
  ],
}

const SAVED_RESULT = {
  role: 'user',
  content: [{ type: 'tool_result', tool_use_id: 's1', content: '{"ok":true,"dataSourceId":19}' }],
}

beforeEach(() => {
  FakeEventSource.reset()
  vi.stubGlobal('EventSource', FakeEventSource)
  client.postToolResult.mockResolvedValue({ accepted: true })
  queries.get.mockResolvedValue({
    id: 137,
    name: 'Live route',
    data_source_id: 19,
    is_archived: false,
    options: { parameters: [{ name: 'route', type: 'query', value: 'R020', queryId: 136 }] },
    visualizations: [{ id: 1372, type: 'TABLE', name: 'Table', options: {} }],
  })
  execution.executeSavedQuery.mockResolvedValue({ id: 9, data: DATA })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('a reloaded saved-query step', () => {
  it('rerun_of_saved_step_uses_saved_path_not_adhoc', async () => {
    client.getThread.mockResolvedValue(detail([storedTurn([SAVED_CALL, SAVED_RESULT])]))
    const { result } = await mounted()
    act(() => result.current.rerun('s1'))
    await waitFor(() => expect(result.current.results.s1).toEqual(DATA))
    expect(execution.executeSavedQuery).toHaveBeenCalledWith(
      137,
      expect.objectContaining({ maxAge: 0, parameters: { route: 'R720' } })
    )
    expect(execution.executeAdhoc).not.toHaveBeenCalled()
    expect(result.current.visualizations.s1).toMatchObject({ id: 1372 })
    expect(client.postToolResult).not.toHaveBeenCalled()
  })

  it('offers_the_rerun_for_a_view_only_analyst_because_it_never_touches_adhoc', async () => {
    execution.executeAdhoc.mockRejectedValue(new Error('data source 19 is view-only'))
    client.getThread.mockResolvedValue(detail([storedTurn([SAVED_CALL, SAVED_RESULT])]))
    const { result } = await mounted()
    act(() => result.current.rerun('s1'))
    await waitFor(() => expect(result.current.results.s1).toEqual(DATA))
    expect(result.current.runErrors.s1).toBeUndefined()
  })
})
