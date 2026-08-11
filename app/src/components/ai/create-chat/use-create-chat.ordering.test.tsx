// The token guard on the SUCCESS path, tested where it is reachable.
//
// create-chat-dialog.test.tsx covers supersession through the UI, but it cannot
// reach this branch: a second send aborts the first request, so the first turn
// rejects and only the rejection-side guard runs. Removing the success-side
// check leaves that test green, which is the same as not having tested it.
//
// The hook does not depend on abort for correctness, deliberately: aborting is
// best effort, and a request already answered when the abort lands still
// resolves. So the contract worth testing is the one the hook actually
// promises: if two turns settle OUT OF ORDER, only the newest lands. That needs
// a converse whose promise ignores the signal, which is what this substitutes.
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ConverseResponse } from '@/types/ai-create'
import { useCreateChat } from './use-create-chat'

const settle: Array<(response: ConverseResponse) => void> = []

vi.mock('@/hooks/use-ai', () => ({
  useAiEnabled: () => true,
  useConverse: () => ({
    isPending: false,
    // Ignores the signal on purpose: see the note above.
    mutateAsync: () =>
      new Promise<ConverseResponse>((resolve) => {
        settle.push(resolve)
      }),
  }),
}))

function reply(text: string): ConverseResponse {
  return { reply: text, suggestedAnswers: [], ready: false, proposal: null, focusTable: null }
}

function proposed(name: string): ConverseResponse {
  return {
    reply: 'Here it is.',
    suggestedAnswers: [],
    ready: true,
    focusTable: null,
    proposal: {
      kind: 'snippet',
      trigger: name,
      snippet: 'captured_at > now() - INTERVAL 7 DAY',
      description: '',
    },
  }
}

describe('useCreateChat turn ordering', () => {
  it('drops a superseded reply that resolves after the one that replaced it', async () => {
    settle.length = 0
    const { result } = renderHook(() => useCreateChat('query'))

    await act(async () => {
      result.current.send('first')
    })
    await act(async () => {
      result.current.send('second')
    })
    expect(settle).toHaveLength(2)

    // The NEWER turn answers first, then the older one arrives late. Without
    // the token check the stale reply appends after the fresh one, and it is
    // what the user is left reading.
    await act(async () => {
      settle[1](reply('FRESH'))
    })
    await act(async () => {
      settle[0](reply('STALE'))
    })

    expect(result.current.turns.map((turn) => `${turn.role}: ${turn.content}`)).toEqual([
      'user: first',
      'user: second',
      'assistant: FRESH',
    ])
  })

  // proposalSeq is what the dialog keys the proposal card on, and the card
  // holds every editable field in state seeded on mount. So this number decides
  // when a card is thrown away and rebuilt, and both directions are wrong in a
  // way the user pays for.
  it('marks a revised proposal as a new one, and an interview turn as not', async () => {
    settle.length = 0
    const { result } = renderHook(() => useCreateChat('snippet'))

    await act(async () => {
      result.current.send('a snippet for last week')
    })
    await act(async () => {
      settle[0](proposed('last7'))
    })
    const first = result.current.proposalSeq
    expect(first).toBeGreaterThan(0)

    // A revision must rebuild the card: keeping it would show the name the user
    // typed over a proposal they have not seen, and write that pair.
    await act(async () => {
      result.current.send('make it 30 days')
    })
    await act(async () => {
      settle[1](proposed('last30'))
    })
    expect(result.current.proposalSeq).not.toBe(first)

    // An interview turn must NOT: it leaves the card standing, and rebuilding
    // it would silently discard edits the user has already made to it.
    const second = result.current.proposalSeq
    await act(async () => {
      result.current.send('actually, what do you suggest?')
    })
    await act(async () => {
      settle[2](reply('Which table should it read?'))
    })
    expect(result.current.proposalSeq).toBe(second)
  })
})
