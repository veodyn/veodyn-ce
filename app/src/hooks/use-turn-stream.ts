'use client'

import { useCallback, useEffect, useRef } from 'react'
import { CHAT_EVENTS, TERMINAL_EVENTS, parseFrame, type ChatFrame } from '@/lib/chat/frames'
import { chatStreamUrl } from '@/services/ai/chat-client'

export interface TurnStreamHandlers {
  onFrame: (turnId: string, frame: ChatFrame) => void
  onLost: (turnId: string) => void
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

  const attach = useCallback((turnId: string) => {
    source.current?.close()
    const stream = new EventSource(chatStreamUrl(turnId))
    source.current = stream
    const end = (lost: boolean) => {
      stream.close()
      if (source.current === stream) source.current = null
      if (lost) latest.current.onLost(turnId)
    }
    for (const event of CHAT_EVENTS) {
      stream.addEventListener(event, (message) => {
        if (!(message instanceof MessageEvent)) return
        const frame = frameOf(event, message)
        if (frame === null) return end(true)
        latest.current.onFrame(turnId, frame)
        if (TERMINAL_EVENTS.has(frame.event)) end(false)
      })
    }
    stream.onerror = () => {
      if (stream.readyState === EventSource.CLOSED) end(true)
    }
  }, [])

  useEffect(() => detach, [detach])

  return { attach, detach }
}
