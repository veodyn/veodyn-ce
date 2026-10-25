import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError, ErrorIds } from '@/lib/errorIds'
import type { ChatToolResult } from './tool-results'
import { postToolResultSafely } from './post-result'

const chat = vi.hoisted(() => ({ postToolResult: vi.fn() }))
vi.mock('@/services/ai/chat-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/ai/chat-client')>()),
  postToolResult: chat.postToolResult,
}))

function refused(status: number) {
  return new AppError(ErrorIds.AI_REQUEST_FAILED, 'refused', { status })
}

const RESULT: ChatToolResult = { kind: 'query_detail', ok: true }

beforeEach(() => vi.clearAllMocks())

describe('postToolResultSafely', () => {
  it('posts a result once when the route takes it', async () => {
    chat.postToolResult.mockResolvedValue({ accepted: true })
    await postToolResultSafely('t1', 'c1', RESULT)
    expect(chat.postToolResult).toHaveBeenCalledTimes(1)
  })

  it('posts a same-kind failure once when the route refuses the result with a 4xx', async () => {
    chat.postToolResult.mockRejectedValueOnce(refused(422)).mockResolvedValue({ accepted: true })
    await postToolResultSafely('t1', 'c1', RESULT)
    expect(chat.postToolResult).toHaveBeenCalledTimes(2)
    expect(chat.postToolResult).toHaveBeenLastCalledWith('t1', 'c1', {
      kind: 'query_detail',
      ok: false,
      error: 'The result could not be sent to chat: it was refused (422).',
    })
  })

  it('keeps the data source id on a refused schema result', async () => {
    chat.postToolResult.mockRejectedValueOnce(refused(422)).mockResolvedValue({ accepted: true })
    await postToolResultSafely('t1', 'c1', { kind: 'data_source_schema', ok: true, dataSourceId: 7 })
    expect(chat.postToolResult).toHaveBeenLastCalledWith(
      't1',
      'c1',
      expect.objectContaining({ kind: 'data_source_schema', ok: false, dataSourceId: 7 })
    )
  })

  it('does not retry a server error or an unreachable chat', async () => {
    chat.postToolResult.mockRejectedValue(refused(500))
    await postToolResultSafely('t1', 'c1', RESULT)
    chat.postToolResult.mockRejectedValue(new Error('offline'))
    await postToolResultSafely('t1', 'c2', RESULT)
    expect(chat.postToolResult).toHaveBeenCalledTimes(2)
  })

  it('posts the fallback only once when it is refused too', async () => {
    chat.postToolResult.mockRejectedValue(refused(422))
    await postToolResultSafely('t1', 'c1', RESULT)
    expect(chat.postToolResult).toHaveBeenCalledTimes(2)
  })
})
