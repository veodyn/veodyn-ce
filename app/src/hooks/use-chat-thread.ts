'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { TERMINAL_EVENTS, type ChatFrame } from '@/lib/chat/frames'
import {
  addPromotion,
  applyFrame,
  emptyThread,
  failTurn,
  fromDetail,
  runningTurn,
  settleCall,
  startTurn,
  type ThreadState,
} from '@/lib/chat/thread-model'
import type { ChatToolResult } from '@/lib/chat/tool-results'
import type { ChatPromotion } from '@/lib/chat/wire'
import type { QueryResultData } from '@/lib/mock-data'
import { cancelTurn, chatErrorStatus, getThread, postTurn } from '@/services/ai/chat-client'
import { CHAT_THREADS_KEY } from './use-chat'
import { useToolExecutor } from './use-tool-executor'
import { useTurnStream } from './use-turn-stream'

export const LOST_TURN_MESSAGE = 'The connection to this reply was lost. Reload the page to see how it ended.'
export const BUSY_MESSAGE = 'A reply is still being written. Wait for it, or stop it first.'
export const SEND_FAILED_MESSAGE = 'The message could not be sent. Try again.'

export interface ChatThreadController {
  state: ThreadState
  results: Record<string, QueryResultData>
  runErrors: Record<string, string>
  loading: boolean
  loadFailed: boolean
  busy: boolean
  sendError: string | null
  send: (text: string) => void
  stop: () => void
  retry: () => void
  rerun: (callId: string, dataSourceId: number) => void
  promoted: (draftId: string, promotion: ChatPromotion) => void
}

export function useChatThread(threadId: string): ChatThreadController {
  const queryClient = useQueryClient()
  const [state, setState] = useState<ThreadState>(emptyThread)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const { results, errors, execute, rerun: rerunQuery } = useToolExecutor()

  const onResult = useCallback((callId: string, result: ChatToolResult) => {
    setState((current) => settleCall(current, callId, result))
  }, [])

  const onFrame = useCallback(
    (turnId: string, frame: ChatFrame) => {
      setState((current) => applyFrame(current, turnId, frame))
      if (frame.event === 'tool_request') execute(turnId, frame.data, onResult)
      if (TERMINAL_EVENTS.has(frame.event)) void queryClient.invalidateQueries({ queryKey: CHAT_THREADS_KEY })
    },
    [execute, onResult, queryClient]
  )

  const onLost = useCallback((turnId: string) => {
    setState((current) => failTurn(current, turnId, LOST_TURN_MESSAGE))
  }, [])

  const { attach } = useTurnStream({ onFrame, onLost })

  useEffect(() => {
    const controller = new AbortController()
    getThread(threadId, controller.signal).then(
      (detail) => {
        const loaded = fromDetail(detail)
        setState(loaded)
        setLoading(false)
        const active = runningTurn(loaded)
        if (active) attach(active.id)
      },
      () => {
        if (controller.signal.aborted) return
        setLoadFailed(true)
        setLoading(false)
      }
    )
    return () => controller.abort()
  }, [threadId, attach])

  const busy = sending || runningTurn(state) !== null

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || busy) return
      setSending(true)
      setSendError(null)
      postTurn(threadId, trimmed)
        .then(
          (started) => {
            setState((current) => startTurn(current, started.turnId, started.seq, trimmed))
            attach(started.turnId)
            void queryClient.invalidateQueries({ queryKey: CHAT_THREADS_KEY })
          },
          (error: unknown) => {
            setSendError(chatErrorStatus(error) === 409 ? BUSY_MESSAGE : SEND_FAILED_MESSAGE)
          }
        )
        .finally(() => setSending(false))
    },
    [busy, threadId, attach, queryClient]
  )

  const stop = useCallback(() => {
    const active = runningTurn(state)
    if (active) void cancelTurn(active.id).catch(() => undefined)
  }, [state])

  const retry = useCallback(() => {
    const last = state.turns[state.turns.length - 1]
    if (last?.status === 'failed') send(last.userText)
  }, [state, send])

  const rerun = useCallback(
    (callId: string, dataSourceId: number) => {
      const run = state.runs[callId]
      if (run) rerunQuery(callId, run.sql, dataSourceId)
    },
    [state, rerunQuery]
  )

  const promoted = useCallback((draftId: string, promotion: ChatPromotion) => {
    setState((current) => addPromotion(current, draftId, promotion))
  }, [])

  return {
    state,
    results,
    runErrors: errors,
    loading,
    loadFailed,
    busy,
    sendError,
    send,
    stop,
    retry,
    rerun,
    promoted,
  }
}
