'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { TERMINAL_EVENTS, type ChatFrame } from '@/lib/chat/frames'
import {
  addDashboardPromotion,
  addPromotion,
  applyFrame,
  emptyThread,
  failTurn,
  fromDetail,
  runningTurn,
  setActiveDashboard,
  settleCall,
  startTurn,
  type ActiveDashboard,
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
  rerun: (callId: string) => void
  reload: () => void
  promoted: (draftId: string, promotion: ChatPromotion) => void
  promotedDashboard: (draftId: string, promotion: ChatPromotion) => void
  dashboardActive: (dashboard: ActiveDashboard) => void
}

export function useChatThread(threadId: string): ChatThreadController {
  const queryClient = useQueryClient()
  const [state, setState] = useState<ThreadState>(emptyThread)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
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

  const onInvalid = useCallback((turnId: string) => {
    setState((current) => failTurn(current, turnId, LOST_TURN_MESSAGE))
  }, [])

  // A dropped EventSource is not proof the turn is dead: the server may still
  // be thinking (or waiting on a browser-run query) minutes after the stream
  // itself goes idle and closes. `getThread` is the one call that knows the
  // truth, via the same lease-liveness check the initial mount already relies
  // on, so a disconnect reconciles through it rather than declaring the turn
  // lost on the client's own say-so. The indirection through a ref breaks the
  // cycle: useTurnStream needs a stable onDisconnected before resync/reconnect
  // (which need attach, returned by useTurnStream) exist.
  const onDisconnectedRef = useRef<(turnId: string) => void>(() => undefined)
  const onDisconnected = useCallback((turnId: string) => onDisconnectedRef.current(turnId), [])

  const { attach } = useTurnStream({ onFrame, onInvalid, onDisconnected })

  const resync = useCallback(
    (signal?: AbortSignal) =>
      getThread(threadId, signal).then((detail) => {
        const loaded = fromDetail(detail)
        setState(loaded)
        const active = runningTurn(loaded)
        if (active) attach(active.id, active.lastEventId)
        return loaded
      }),
    [threadId, attach]
  )

  // Deliberately narrower than resync(): a turn's `blocks` are only written
  // once it finishes (services/chat/store.py's finish_turn), so a still-running
  // turn's detail always reconstructs empty items. Replacing state with that
  // via resync() would erase every card the live stream already rendered for
  // it. Reattaching without touching state is correct whenever the server
  // still calls the turn running; a full resync only happens once it has
  // genuinely settled, when blocks, and the real outcome, are in hand.
  const reconnect = useCallback(
    (turnId: string) =>
      getThread(threadId).then((detail) => {
        const stillRunning = detail.turns.find((turn) => turn.id === turnId && turn.status === 'running')
        if (stillRunning) {
          attach(stillRunning.id, stillRunning.lastEventId)
          return
        }
        setState(fromDetail(detail))
      }),
    [threadId, attach]
  )

  useEffect(() => {
    onDisconnectedRef.current = (turnId: string) => {
      void reconnect(turnId).catch(() => {
        setState((current) => failTurn(current, turnId, LOST_TURN_MESSAGE))
      })
    }
  }, [reconnect])

  useEffect(() => {
    const controller = new AbortController()
    resync(controller.signal).then(
      () => setLoading(false),
      () => {
        if (controller.signal.aborted) return
        setLoadFailed(true)
        setLoading(false)
      }
    )
    return () => controller.abort()
  }, [resync, loadAttempt])

  const reload = useCallback(() => {
    setLoadFailed(false)
    setLoading(true)
    setLoadAttempt((attempt) => attempt + 1)
  }, [])

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
    if (last?.status !== 'failed') return
    if (last.errorMessage === LOST_TURN_MESSAGE) {
      void resync().catch(() => undefined)
      return
    }
    send(last.userText)
  }, [state, send, resync])

  const rerun = useCallback(
    (callId: string) => {
      const run = state.runs[callId]
      if (run) rerunQuery(callId, run.sql, run.dataSourceId)
    },
    [state, rerunQuery]
  )

  const promoted = useCallback((draftId: string, promotion: ChatPromotion) => {
    setState((current) => addPromotion(current, draftId, promotion))
  }, [])

  const promotedDashboard = useCallback((draftId: string, promotion: ChatPromotion) => {
    setState((current) => addDashboardPromotion(current, draftId, promotion))
  }, [])

  const dashboardActive = useCallback((dashboard: ActiveDashboard) => {
    setState((current) => setActiveDashboard(current, dashboard))
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
    reload,
    promoted,
    promotedDashboard,
    dashboardActive,
  }
}
