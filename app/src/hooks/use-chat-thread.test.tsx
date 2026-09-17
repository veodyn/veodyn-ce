import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError, ErrorIds } from '@/lib/errorIds'
import { FakeEventSource } from '@/test/fake-event-source'
import { BUSY_MESSAGE, LOST_TURN_MESSAGE, useChatThread } from './use-chat-thread'

const client = vi.hoisted(() => ({
  getThread: vi.fn(),
  postTurn: vi.fn(),
  postToolResult: vi.fn(),
  cancelTurn: vi.fn(),
}))
const execution = vi.hoisted(() => ({ executeAdhoc: vi.fn() }))

vi.mock('@/services/ai/chat-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/ai/chat-client')>()),
  ...client,
}))
vi.mock('@/services/redash/execution', () => execution)
const queries = vi.hoisted(() => ({ search: vi.fn(), get: vi.fn() }))
vi.mock('@/services/redash/queries', () => queries)

const THREAD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TURN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const REQUEST = {
  callId: 'c1',
  tool: 'run_query',
  args: { dataSourceId: 5, sql: 'SELECT 1 FROM t', purpose: 'average', vizChoiceId: 'counter' },
}
const DATA = {
  columns: [{ name: 'n', type: 'integer', friendly_name: 'n' }],
  rows: [{ n: 1 }, { n: 2 }],
}

function detail(turns: unknown[] = []) {
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

beforeEach(() => {
  FakeEventSource.reset()
  vi.stubGlobal('EventSource', FakeEventSource)
  client.getThread.mockResolvedValue(detail())
  client.postTurn.mockResolvedValue({ turnId: TURN, seq: 1 })
  client.postToolResult.mockResolvedValue({ accepted: true })
  client.cancelTurn.mockResolvedValue({ accepted: true })
  execution.executeAdhoc.mockResolvedValue({ data: DATA })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('useChatThread', () => {
  it('runs a library search in the browser and shows its result', async () => {
    queries.search.mockResolvedValue({
      results: [{ id: 12, name: 'Trips', description: '', tags: [], is_archived: false, latest_query_data_id: 1 }],
      count: 1,
    })
    const { result } = await mounted()
    act(() => result.current.send('bikeshare?'))
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    const request = { callId: 's1', tool: 'search_library', args: { text: 'bikeshare', kinds: ['query'], tags: [] } }
    act(() => FakeEventSource.latest().emit('tool_request', request, '1-1'))
    await waitFor(() => expect(client.postToolResult).toHaveBeenCalledTimes(1))
    const [, callId, posted] = client.postToolResult.mock.calls[0]
    expect(callId).toBe('s1')
    expect(posted).toMatchObject({ kind: 'library', ok: true, items: [{ type: 'query', id: 12, hasResult: true }] })
    expect(result.current.state.calls.s1).toMatchObject({ status: 'done', output: posted })
    expect(result.current.state.turns[0].items).toEqual([{ kind: 'call', callId: 's1' }])
    expect(execution.executeAdhoc).not.toHaveBeenCalled()
  })

  it('sends, streams, and runs a requested query once', async () => {
    const { result } = await mounted()
    act(() => result.current.send('  how fast?  '))
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    expect(client.postTurn).toHaveBeenCalledWith(THREAD, 'how fast?')
    const stream = FakeEventSource.latest()
    expect(stream.url).toBe(`/api/ai/chat/turns/${TURN}/stream`)
    expect(result.current.busy).toBe(true)

    act(() => {
      stream.emit('text_delta', { text: 'Checking.' }, '1-1')
      stream.emit('tool_request', REQUEST, '1-2')
      stream.emit('tool_request', REQUEST, '1-2')
    })
    await waitFor(() => expect(client.postToolResult).toHaveBeenCalledTimes(1))
    expect(execution.executeAdhoc).toHaveBeenCalledTimes(1)
    expect(execution.executeAdhoc).toHaveBeenCalledWith(5, 'SELECT 1 FROM t', expect.objectContaining({ applyAutoLimit: true }))
    const [, callId, shaped] = client.postToolResult.mock.calls[0]
    expect(callId).toBe('c1')
    expect(shaped).toMatchObject({ ok: true, rowCount: 2, truncated: false })
    expect(result.current.results.c1).toEqual(DATA)

    act(() => stream.emit('turn_done', { stopReason: 'end_turn', usage: {} }, '1-3'))
    expect(stream.readyState).toBe(FakeEventSource.CLOSED)
    expect(result.current.busy).toBe(false)
    expect(result.current.state.turns[0].items[0]).toEqual({ kind: 'text', text: 'Checking.' })
  })

  it('reports a failed run to the model', async () => {
    execution.executeAdhoc.mockRejectedValue(new Error('Code: 60. Unknown table'))
    const { result } = await mounted()
    act(() => result.current.send('go'))
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    act(() => FakeEventSource.latest().emit('tool_request', REQUEST, '1-1'))
    await waitFor(() => expect(client.postToolResult).toHaveBeenCalled())
    expect(client.postToolResult.mock.calls[0][2]).toMatchObject({ ok: false })
    expect(result.current.runErrors.c1).toBeTruthy()
  })

  it('attaches to a turn that is still running when the thread loads', async () => {
    client.getThread.mockResolvedValue(
      detail([
        {
          id: TURN,
          seq: 1,
          status: 'running',
          userText: 'q',
          blocks: [],
          stopReason: null,
          errorId: null,
          createdAt: 'x',
          finishedAt: null,
        },
      ])
    )
    const { result } = await mounted()
    expect(FakeEventSource.latest().url).toContain(TURN)
    expect(result.current.busy).toBe(true)
    act(() => FakeEventSource.latest().fail())
    expect(result.current.state.turns[0]).toMatchObject({ status: 'failed', errorMessage: LOST_TURN_MESSAGE })
  })

  it('keeps a turn running through a dropped connection', async () => {
    const { result } = await mounted()
    act(() => result.current.send('go'))
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    const stream = FakeEventSource.latest()
    act(() => stream.drop())
    expect(stream.readyState).toBe(FakeEventSource.CONNECTING)
    expect(result.current.state.turns[0].status).toBe('running')
    act(() => stream.emit('turn_done', { stopReason: 'end_turn', usage: {} }, '1-1'))
    expect(result.current.state.turns[0].status).toBe('done')
  })

  it('treats an invalid frame as a lost stream', async () => {
    const { result } = await mounted()
    act(() => result.current.send('go'))
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    act(() => FakeEventSource.latest().emit('text_delta', { nope: true }, '1-1'))
    expect(result.current.state.turns[0].status).toBe('failed')
    expect(FakeEventSource.latest().readyState).toBe(FakeEventSource.CLOSED)
  })

  it('says so when a reply is already running', async () => {
    client.postTurn.mockRejectedValue(new AppError(ErrorIds.AI_REQUEST_FAILED, 'busy', { status: 409 }))
    const { result } = await mounted()
    act(() => result.current.send('go'))
    await waitFor(() => expect(result.current.sendError).toBe(BUSY_MESSAGE))
  })

  it('stops the running turn and retries a failed one', async () => {
    const { result } = await mounted()
    act(() => result.current.send('first'))
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    act(() => result.current.stop())
    expect(client.cancelTurn).toHaveBeenCalledWith(TURN)
    act(() => FakeEventSource.latest().emit('error', { id: 'X', message: 'boom' }))
    client.postTurn.mockResolvedValue({ turnId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', seq: 2 })
    act(() => result.current.retry())
    await waitFor(() => expect(client.postTurn).toHaveBeenLastCalledWith(THREAD, 'first'))
  })

  it('reruns a stored query to draw it again', async () => {
    client.getThread.mockResolvedValue(
      detail([
        {
          id: TURN,
          seq: 1,
          status: 'done',
          userText: 'q',
          stopReason: 'end_turn',
          errorId: null,
          createdAt: 'x',
          finishedAt: 'x',
          blocks: [
            { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'run_query', input: { sql: 'SELECT 2 FROM t' } }] },
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: '{"ok":true}' }] },
          ],
        },
      ])
    )
    const { result } = await mounted()
    act(() => result.current.rerun('c1', 9))
    await waitFor(() => expect(result.current.results.c1).toEqual(DATA))
    expect(execution.executeAdhoc).toHaveBeenCalledWith(9, 'SELECT 2 FROM t', expect.anything())
    expect(client.postToolResult).not.toHaveBeenCalled()
  })

  it('reports a thread that will not load', async () => {
    client.getThread.mockRejectedValue(new Error('404'))
    const { result } = await mounted()
    expect(result.current.loadFailed).toBe(true)
  })
})
