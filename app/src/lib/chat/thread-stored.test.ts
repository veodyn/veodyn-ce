import { describe, expect, it } from 'vitest'
import type { ChatFrame } from './frames'
import { applyFrame, emptyThread, fromDetail, startTurn } from './thread-model'
import type { ChatThreadDetail } from './wire'

const TURN = '11111111-1111-4111-8111-111111111111'

function detailWith(blocks: ChatThreadDetail['turns'][number]['blocks']): ChatThreadDetail {
  return {
    thread: { id: TURN, title: 't', pinned: false, createdAt: 'x', updatedAt: 'x', lastTurnAt: 'x' },
    turns: [
      {
        id: TURN,
        seq: 1,
        status: 'done',
        userText: 'show route 720',
        stopReason: 'end_turn',
        errorId: null,
        createdAt: 'x',
        finishedAt: 'x',
        blocks,
      },
    ],
    drafts: [],
  }
}

const SAVED_CALL = {
  role: 'assistant',
  content: [
    {
      type: 'tool_use',
      id: 's1',
      name: 'run_saved_query',
      input: { queryId: 137, params: { route: 'R720' }, visualizationId: 1372, purpose: 'Route 720 live' },
    },
  ],
}

const resultMessage = (content: string, isError = false) => ({
  role: 'user',
  content: [{ type: 'tool_result', tool_use_id: 's1', content, ...(isError ? { is_error: true } : {}) }],
})

describe('a stored saved-query run', () => {
  it('stored_thread_restores_saved_run_spec', () => {
    const state = fromDetail(
      detailWith([
        SAVED_CALL,
        resultMessage('{"ok":true,"rowCount":102,"dataSourceId":15,"savedQueryId":137}'),
      ] as never)
    )
    expect(state.runs.s1).toMatchObject({
      callId: 's1',
      dataSourceId: 15,
      purpose: 'Route 720 live',
      status: 'done',
      rowCount: 102,
      saved: { queryId: 137, parameters: { route: 'R720' }, visualizationId: 1372 },
    })
    expect(state.turns[0].items).toEqual([{ kind: 'run', callId: 's1' }])
    expect(state.calls.s1).toBeUndefined()
  })

  it('restores_a_run_node_refused_as_failed_with_its_text', () => {
    const state = fromDetail(
      detailWith([SAVED_CALL, resultMessage('{"ok":false,"error":"Invalid parameter value for route"}')] as never)
    )
    expect(state.runs.s1).toMatchObject({ status: 'failed', error: 'Invalid parameter value for route' })
  })

  it('restores_a_failed_run_stored_with_is_error_as_the_runner_records_it', () => {
    const state = fromDetail(
      detailWith([
        SAVED_CALL,
        resultMessage('{"kind":"query_result","ok":false,"error":"Invalid parameter value for route"}', true),
      ] as never)
    )
    expect(state.runs.s1).toMatchObject({ status: 'failed', error: 'Invalid parameter value for route' })
    expect(state.turns[0].items).toEqual([{ kind: 'run', callId: 's1' }])
  })

  it('does_not_show_a_sidecar_validation_refusal_as_a_run', () => {
    const state = fromDetail(detailWith([SAVED_CALL, resultMessage('queryId must be the id of a saved query', true)] as never))
    expect(state.runs.s1).toBeUndefined()
  })

  it('reads_a_missing_visualization_id_as_none', () => {
    const call = {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 's1', name: 'run_saved_query', input: { queryId: 5, params: {}, purpose: 'p' } }],
    }
    const state = fromDetail(detailWith([call, resultMessage('{"ok":true}')] as never))
    expect(state.runs.s1.saved).toEqual({ queryId: 5, parameters: {}, visualizationId: null })
  })

  it('drops_a_stored_call_with_no_usable_query_id', () => {
    const call = {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 's1', name: 'run_saved_query', input: { params: {}, purpose: 'p' } }],
    }
    const state = fromDetail(detailWith([call, resultMessage('{"ok":true}')] as never))
    expect(state.runs.s1).toBeUndefined()
  })
})

describe('a live saved-query request', () => {
  const frame: ChatFrame = {
    event: 'tool_request',
    id: '1-2',
    data: {
      callId: 's1',
      tool: 'run_saved_query',
      args: { queryId: 137, parameters: { route: 'R720' }, visualizationId: 1372, purpose: 'Route 720 live' },
    },
  }

  it('shows_as_a_run_carrying_its_saved_spec_and_not_as_a_card_call', () => {
    const state = applyFrame(startTurn(emptyThread(), TURN, 1, 'go'), TURN, frame)
    expect(state.runs.s1).toMatchObject({
      status: 'running',
      purpose: 'Route 720 live',
      saved: { queryId: 137, parameters: { route: 'R720' }, visualizationId: 1372 },
    })
    expect(state.calls.s1).toBeUndefined()
    expect(state.turns[0].items).toEqual([{ kind: 'run', callId: 's1' }])
  })
})
