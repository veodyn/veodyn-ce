'use client'

import { useCallback, useEffect, useRef } from 'react'
import { CHAT_EVENTS, TERMINAL_EVENTS, parseFrame, type ChatFrame } from '@/lib/chat/frames'
import { chatStreamUrl } from '@/services/ai/chat-client'

export interface TurnStreamHandlers {
  onFrame: (turnId: string, frame: ChatFrame) => void
  /** The server sent something the wire schema refuses. A real protocol failure: not worth reconnecting over. */
  onInvalid: (turnId: string) => void
  /**
   * The connection closed without a terminal frame. This is the common case for an
   * idle long poll going quiet, not proof the turn is dead, so it is the caller's job
   * to reconcile against the server before deciding whether to give up.
   */
  onDisconnected: (turnId: string) => void
}

function frameOf(event: string, message: MessageEvent): ChatFrame | null {
  try {
    return parseFrame(event, JSON.parse(String(message.data)), message.lastEventId || null)
  } catch {
    return null
  }
}

export function useTurnStream(handlers: TurnStreamHandlers) {
  const latest = useRef(handlers)
  const source = useRef<EventSource | null>(null)

  useEffect(() => {
    latest.current = handlers
  })

  const detach = useCallback(() => {
    source.current?.close()
    source.current = null
  }, [])

  const attach = useCallback((turnId: string, after?: string | null) => {
    source.current?.close()
    const stream = new EventSource(chatStreamUrl(turnId, after))
    source.current = stream
    const end = (reason: 'invalid' | 'disconnected' | null) => {
      stream.close()
      if (source.current === stream) source.current = null
      if (reason === 'invalid') latest.current.onInvalid(turnId)
      else if (reason === 'disconnected') latest.current.onDisconnected(turnId)
    }
    for (const event of CHAT_EVENTS) {
      stream.addEventListener(event, (message) => {
        if (!(message instanceof MessageEvent)) return
        const frame = frameOf(event, message)
        if (frame === null) return end('invalid')
        latest.current.onFrame(turnId, frame)
        if (TERMINAL_EVENTS.has(frame.event)) end(null)
      })
    }
    stream.onerror = () => {
      if (stream.readyState === EventSource.CLOSED) end('disconnected')
    }
  }, [])

  useEffect(() => detach, [detach])

  return { attach, detach }
}
