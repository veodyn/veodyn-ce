'use client'

// The transcript and the send lifecycle for one Create-with-AI conversation.
// There is no persistence and no resume (spec section 7): the conversation
// lives for as long as this hook is mounted, and unmounting is the discard.
//
// It returns callbacks and never its setters. A setter that escapes a custom
// hook is not known-stable to the React Compiler, so every useCallback in a
// caller that closed over it would fail react-hooks/preserve-manual-memoization
// (../../../../CLAUDE.md).
import { useCallback, useEffect, useRef, useState } from 'react'
import { useConverse } from '@/hooks/use-ai'
import type { AnyProposal, ConverseMessage, CreateKind } from '@/types/ai-create'
import {
  appendTurn,
  assistantTurn,
  dropTrailingFailures,
  failedTurn,
  isAtTurnCap,
  toConverseMessages,
  userTurn,
  type ChatTurn,
  type NewChatTurn,
} from './create-chat-model'

export interface CreateChat {
  turns: ChatTurn[]
  /** The proposal the newest reply carried, or null while still interviewing. */
  proposal: AnyProposal | null
  /**
   * Which proposal this is. The card holds every editable field in its own
   * state, initialized on mount, and a revision arriving in the same slot is
   * reconciled rather than remounted: React keeps the state and swaps only the
   * props. The card would then show the old name over the new SQL and write
   * that pair. Keying the card on this is what makes a revision a new card.
   */
  proposalSeq: number
  /** True from the moment a turn is posted until it lands or fails. */
  sending: boolean
  /** Post one user message. Ignored at the turn cap or on empty input. */
  send: (content: string) => void
  /** Re-send the turn that failed, without spending another of the twelve. */
  retry: () => void
}

export function useCreateChat(kind: CreateKind, targetDashboardId?: number): CreateChat {
  const converse = useConverse()
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [proposal, setProposal] = useState<AnyProposal | null>(null)
  const [proposalSeq, setProposalSeq] = useState(0)

  // The transcript a send has to post is the one that includes the message
  // being sent, and a state update is not readable in the call that made it.
  // Every write goes through append or commit, so the ref and the state never
  // diverge.
  const turnsRef = useRef<ChatTurn[]>([])
  const commit = useCallback((next: ChatTurn[]) => {
    turnsRef.current = next
    setTurns(next)
  }, [])

  // React keys come from a counter that only goes up. A retry drops the failure
  // bubble, so a key derived from the transcript itself would be reissued to
  // the reply that takes its place.
  const seqRef = useRef(0)
  const append = useCallback(
    (turn: NewChatTurn): ChatTurn[] => {
      seqRef.current += 1
      const next = appendTurn(turnsRef.current, turn, seqRef.current)
      commit(next)
      return next
    },
    [commit]
  )

  // A superseded or unmounted turn must not land in the transcript. Each post
  // gets its own controller and a monotonic token: a newer post aborts the old
  // request, and only the current token's outcome is applied. The pattern in
  // ai-prompt-bar.tsx, for the same reason it is there.
  const controllerRef = useRef<AbortController | null>(null)
  const tokenRef = useRef(0)
  useEffect(() => () => controllerRef.current?.abort(), [])

  // The table the service said it profiled, carried from each reply into the
  // next request. That round trip is the whole mechanism: the endpoint is
  // stateless, so a turn that does not hand the name back makes the service
  // re-decide what the conversation is about. A ref rather than state for the
  // same reason the transcript is one: post reads it at send time, and a state
  // value would either be a dependency that rebuilds every callback each turn
  // or the value from the render that scheduled the send.
  const focusTableRef = useRef<string | null>(null)

  // mutateAsync rather than mutate with per-call callbacks: react-query keeps
  // one set of callbacks per observer, so a second mutate() silently replaces
  // the first turn's onSuccess and onError. That happens to drop a superseded
  // reply today, but it drops it inside the library, where this hook cannot see
  // it and a future version is free to change it. The promise always settles,
  // so the token below is what decides.
  const { mutateAsync } = converse
  const post = useCallback(
    (messages: ConverseMessage[]) => {
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller
      const token = tokenRef.current + 1
      tokenRef.current = token

      void mutateAsync({
        kind,
        messages,
        targetDashboardId,
        focusTable: focusTableRef.current,
        signal: controller.signal,
      }).then(
        (response) => {
          if (token !== tokenRef.current) return
          append(assistantTurn(response.reply, response.suggestedAnswers))
          // Seeded from every reply, interview turns included: the table is
          // usually settled several turns before a proposal exists.
          focusTableRef.current = response.focusTable
          // Null when the model went back to asking questions, which takes the
          // card away rather than leaving a stale one to be created.
          setProposal(response.proposal)
          // Bumped only for a proposal, so an interview turn does not throw
          // away a card the user has already started editing.
          if (response.proposal != null) setProposalSeq(seqRef.current)
        },
        (error: unknown) => {
          // A rejection is often this hook aborting itself, and the token check
          // is what tells the two apart: the turn that replaced this one owns
          // the transcript, and a superseded turn reports nothing.
          if (token !== tokenRef.current) return
          // The transcript is left standing, proposal included, so the user can
          // retry rather than start the interview again.
          append(failedTurn(error))
        }
      )
    },
    [append, kind, mutateAsync, targetDashboardId]
  )

  const send = useCallback(
    (content: string) => {
      const text = content.trim()
      if (text === '' || isAtTurnCap(turnsRef.current)) return
      // Optimistic: the message is on screen before the request leaves, so the
      // chat never looks like it swallowed what was typed.
      post(toConverseMessages(append(userTurn(text))))
    },
    [append, post]
  )

  const retry = useCallback(() => {
    const next = dropTrailingFailures(turnsRef.current)
    // Nothing was dropped, so there is no failed turn to re-send.
    if (next === turnsRef.current || next.length === 0) return
    commit(next)
    post(toConverseMessages(next))
  }, [commit, post])

  return { turns, proposal, proposalSeq, sending: converse.isPending, send, retry }
}
