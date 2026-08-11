// The one thing a conversation carries from turn to turn.
//
// The endpoint is stateless: what the service knows about which table is under
// discussion is exactly what the client sends back. So the contract worth
// testing is the round trip itself, and it is invisible in the transcript,
// which is why it needs its own converse substitute rather than an assertion on
// what the chat renders.
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConverseRequest, ConverseResponse } from '@/types/ai-create'
import { useCreateChat } from './use-create-chat'

const sent: Array<ConverseRequest & { signal?: AbortSignal }> = []
let answers: ConverseResponse[] = []

function turn(focusTable: string | null): ConverseResponse {
  return { reply: 'Which period?', suggestedAnswers: [], ready: false, proposal: null, focusTable }
}

vi.mock('@/hooks/use-ai', () => ({
  useAiEnabled: () => true,
  useConverse: () => ({
    isPending: false,
    mutateAsync: (variables: ConverseRequest & { signal?: AbortSignal }) => {
      sent.push(variables)
      return Promise.resolve(answers[sent.length - 1] ?? turn(null))
    },
  }),
}))

beforeEach(() => {
  sent.length = 0
  answers = []
})

describe('useCreateChat focus table', () => {
  it('sends back the table the previous reply named', async () => {
    answers = [turn('analytics.rail_taps'), turn('analytics.rail_taps')]
    const { result } = renderHook(() => useCreateChat('query'))

    await act(async () => {
      result.current.send('rides by station')
    })
    // Nothing to name yet: the first turn is where the service picks one.
    expect(sent[0].focusTable).toBeNull()

    await act(async () => {
      result.current.send('over the last 30 days')
    })

    expect(sent).toHaveLength(2)
    expect(sent[1].focusTable).toBe('analytics.rail_taps')
  })

  it('follows the service when it moves the conversation off that table', async () => {
    // Seeded from every reply, not remembered: a client that kept the last
    // non-null name would keep profiling a table the service has left, and the
    // control above cannot tell that apart from a working round trip.
    answers = [turn('analytics.rail_taps'), turn(null), turn(null)]
    const { result } = renderHook(() => useCreateChat('query'))

    await act(async () => {
      result.current.send('rides by station')
    })
    await act(async () => {
      result.current.send('actually, bike docks')
    })
    await act(async () => {
      result.current.send('per hour')
    })

    expect(sent.map((request) => request.focusTable)).toEqual([
      null,
      'analytics.rail_taps',
      null,
    ])
  })
})
