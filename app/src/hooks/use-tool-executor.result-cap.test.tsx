import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatToolRequest } from '@/lib/chat/frames'
import { CHAT_RESULT_MAX_BYTES, isResultTooLargeMessage } from '@/lib/chat/result-cap'

const postToolResult = vi.hoisted(() => vi.fn())

vi.mock('@/services/ai/chat-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/ai/chat-client')>()),
  postToolResult,
}))

import { useToolExecutor } from './use-tool-executor'

const DATA = { columns: [{ name: 'n', type: 'integer', friendly_name: 'n' }], rows: [{ n: 1 }, { n: 2 }] }
const CHUNK_BYTES = 1024 * 1024

const ADHOC: ChatToolRequest = {
  callId: 'a1',
  tool: 'run_query',
  args: { dataSourceId: 5, sql: 'SELECT * FROM mca_resource', purpose: 'resources', vizChoiceId: 'table' },
}

const SAVED: ChatToolRequest = {
  callId: 's1',
  tool: 'run_saved_query',
  args: { queryId: 137, parameters: {}, visualizationId: null, purpose: 'saved' },
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

function oversizedResult() {
  const source = { pulls: 0, cancelled: false }
  const chunk = new Uint8Array(CHUNK_BYTES).fill(0x78)
  const chunks = Math.ceil(CHAT_RESULT_MAX_BYTES / CHUNK_BYTES) + 4
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        source.pulls += 1
        if (source.pulls > chunks) controller.close()
        else controller.enqueue(chunk)
      },
      cancel() {
        source.cancelled = true
      },
    },
    { highWaterMark: 0 }
  )
  return { source, response: () => new Response(stream, { status: 200 }) }
}

function stubNode(result: () => Response) {
  const routes: Record<string, () => Response> = {
    'POST query_results': () => json({ job: { id: 'j1' } }),
    'GET queries/137': () => json({ id: 137, name: 'Saved', data_source_id: 15, is_archived: false, options: {} }),
    'POST queries/137/results': () => json({ job: { id: 'j1' } }),
    'GET jobs/j1': () => json({ job: { id: 'j1', status: 3, query_result_id: 9 } }),
    'GET query_results/9': result,
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${new URL(input).pathname.replace('/api/node/', '')}`
      const route = routes[key]
      if (!route) throw new Error(`unrouted ${key}`)
      return route()
    })
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  postToolResult.mockResolvedValue({ accepted: true })
})

afterEach(() => vi.unstubAllGlobals())

describe('the chat result byte cap', () => {
  it.each([
    ['run_query', ADHOC],
    ['run_saved_query', SAVED],
  ])('%s_over_the_cap_is_not_parsed_and_tells_the_model_to_narrow_it', async (_tool, request) => {
    const big = oversizedResult()
    stubNode(big.response)
    const { result } = renderHook(() => useToolExecutor())
    act(() => result.current.execute('turn', request, vi.fn()))
    await waitFor(() => expect(postToolResult).toHaveBeenCalled())
    const posted = postToolResult.mock.calls[0][2] as { kind: string; ok: boolean; error: string }
    expect(posted).toMatchObject({ kind: 'query_result', ok: false })
    expect(isResultTooLargeMessage(posted.error)).toBe(true)
    expect(posted.error).toContain(`${CHAT_RESULT_MAX_BYTES.toLocaleString('en-US')} bytes`)
    expect(posted.error).toMatch(/after (\d|,)+ bytes/)
    expect(posted.error).toMatch(/LIMIT/)
    expect(posted.error).toMatch(/MCA resource, pass narrower params/)
    expect(big.source.cancelled).toBe(true)
    expect(big.source.pulls).toBeLessThan(Math.ceil(CHAT_RESULT_MAX_BYTES / CHUNK_BYTES) + 4)
    expect(result.current.results[request.callId]).toBeUndefined()
    await waitFor(() => expect(isResultTooLargeMessage(result.current.errors[request.callId])).toBe(true))
  })

  it('refuses_a_declared_content_length_over_the_cap', async () => {
    const declared = 21_842_609
    stubNode(() => new Response('x', { status: 200, headers: { 'content-length': String(declared) } }))
    const { result } = renderHook(() => useToolExecutor())
    act(() => result.current.execute('turn', ADHOC, vi.fn()))
    await waitFor(() => expect(postToolResult).toHaveBeenCalled())
    const posted = postToolResult.mock.calls[0][2] as { error: string }
    expect(isResultTooLargeMessage(posted.error)).toBe(true)
    expect(posted.error).toContain(declared.toLocaleString('en-US'))
  })

  it('a_result_under_the_cap_passes_through', async () => {
    stubNode(() => json({ query_result: { id: 9, data: DATA, retrieved_at: 't' } }))
    const { result } = renderHook(() => useToolExecutor())
    act(() => result.current.execute('turn', ADHOC, vi.fn()))
    await waitFor(() => expect(postToolResult).toHaveBeenCalled())
    expect(postToolResult).toHaveBeenCalledWith(
      'turn',
      'a1',
      expect.objectContaining({ kind: 'query_result', ok: true, dataSourceId: 5, rowCount: 2 })
    )
    expect(result.current.results.a1).toEqual(DATA)
  })
})
