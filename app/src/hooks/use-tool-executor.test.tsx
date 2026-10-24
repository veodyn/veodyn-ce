import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatToolRequest } from '@/lib/chat/frames'
import { ApiError } from '@/services/api-client'

const postToolResult = vi.hoisted(() => vi.fn())
const queries = vi.hoisted(() => ({ get: vi.fn() }))
const execution = vi.hoisted(() => ({ executeSavedQuery: vi.fn(), executeAdhoc: vi.fn() }))

vi.mock('@/services/ai/chat-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/ai/chat-client')>()),
  postToolResult,
}))
vi.mock('@/services/redash/queries', () => queries)
vi.mock('@/services/redash/execution', () => execution)

import { useToolExecutor } from './use-tool-executor'

const DATA = { columns: [{ name: 'n', type: 'integer', friendly_name: 'n' }], rows: [{ n: 1 }, { n: 2 }] }

const SAVED: ChatToolRequest = {
  callId: 's1',
  tool: 'run_saved_query',
  args: { queryId: 137, parameters: { route: 'R720' }, visualizationId: 1372, purpose: 'Route 720 live' },
}

function savedQuery() {
  return {
    id: 137,
    name: 'Live route',
    data_source_id: 15,
    is_archived: false,
    options: { parameters: [{ name: 'route', type: 'query', value: 'R020', queryId: 136 }] },
    visualizations: [
      { id: 1371, type: 'TABLE', name: 'Table', options: {} },
      { id: 1372, type: 'CHART', name: 'Chart', options: { globalSeriesType: 'line' } },
    ],
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  postToolResult.mockResolvedValue({ accepted: true })
  queries.get.mockResolvedValue(savedQuery())
  execution.executeSavedQuery.mockResolvedValue({ id: 9, data: DATA })
})

describe('a saved query run from the chat', () => {
  it('posts_a_query_result_carrying_the_saved_query_id', async () => {
    const { result } = renderHook(() => useToolExecutor())
    act(() => result.current.execute('turn', SAVED, vi.fn()))
    await waitFor(() => expect(postToolResult).toHaveBeenCalled())
    expect(postToolResult).toHaveBeenCalledWith(
      'turn',
      's1',
      expect.objectContaining({ kind: 'query_result', ok: true, dataSourceId: 15, savedQueryId: 137, rowCount: 2 })
    )
    expect(execution.executeSavedQuery).toHaveBeenCalledWith(
      137,
      expect.objectContaining({ maxAge: 0, parameters: { route: 'R720' } })
    )
  })

  it('keeps_the_rows_and_the_saved_visualization_for_drawing', async () => {
    const { result } = renderHook(() => useToolExecutor())
    act(() => result.current.execute('turn', SAVED, vi.fn()))
    await waitFor(() => expect(result.current.results.s1).toEqual(DATA))
    expect(result.current.visualizations.s1).toMatchObject({ id: 1372, type: 'CHART' })
  })

  it('node_refusal_becomes_a_failed_result_with_its_text', async () => {
    execution.executeSavedQuery.mockRejectedValue(new ApiError(403, 'Invalid parameter value for route'))
    const { result } = renderHook(() => useToolExecutor())
    act(() => result.current.execute('turn', SAVED, vi.fn()))
    await waitFor(() => expect(postToolResult).toHaveBeenCalled())
    expect(postToolResult).toHaveBeenCalledWith('turn', 's1', {
      kind: 'query_result',
      ok: false,
      error: 'Invalid parameter value for route',
    })
    await waitFor(() => expect(result.current.errors.s1).toBe('Invalid parameter value for route'))
  })

  it('runs_once_for_a_request_delivered_twice', async () => {
    const { result } = renderHook(() => useToolExecutor())
    act(() => {
      result.current.execute('turn', SAVED, vi.fn())
      result.current.execute('turn', SAVED, vi.fn())
    })
    await waitFor(() => expect(postToolResult).toHaveBeenCalled())
    expect(execution.executeSavedQuery).toHaveBeenCalledTimes(1)
  })

  it('posts_nothing_once_the_conversation_is_gone', async () => {
    let release: (value: unknown) => void = () => undefined
    execution.executeSavedQuery.mockReturnValue(new Promise((resolve) => (release = resolve)))
    const { result, unmount } = renderHook(() => useToolExecutor())
    act(() => result.current.execute('turn', SAVED, vi.fn()))
    await waitFor(() => expect(execution.executeSavedQuery).toHaveBeenCalled())
    unmount()
    release({ id: 9, data: DATA })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(postToolResult).not.toHaveBeenCalled()
  })

  it('rerun_of_a_saved_spec_runs_the_saved_path_and_posts_nothing', async () => {
    const { result } = renderHook(() => useToolExecutor())
    act(() =>
      result.current.rerun('s1', { kind: 'saved', queryId: 137, parameters: { route: 'R720' }, visualizationId: null })
    )
    await waitFor(() => expect(result.current.results.s1).toEqual(DATA))
    expect(execution.executeSavedQuery).toHaveBeenCalledWith(137, expect.objectContaining({ maxAge: 0 }))
    expect(execution.executeAdhoc).not.toHaveBeenCalled()
    expect(postToolResult).not.toHaveBeenCalled()
  })

  it('rerun_of_an_adhoc_spec_still_uses_the_adhoc_path', async () => {
    execution.executeAdhoc.mockResolvedValue({ data: DATA })
    const { result } = renderHook(() => useToolExecutor())
    act(() => result.current.rerun('a1', { kind: 'adhoc', sql: 'SELECT 1', dataSourceId: 4 }))
    await waitFor(() => expect(result.current.results.a1).toEqual(DATA))
    expect(execution.executeAdhoc).toHaveBeenCalledWith(4, 'SELECT 1', expect.anything())
    expect(execution.executeSavedQuery).not.toHaveBeenCalled()
  })
})
