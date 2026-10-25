'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatThreadSubject } from '@/lib/chat/wire'
import { createThread, deleteThread, postTurn } from '@/services/ai/chat-client'
import { CHAT_THREADS_KEY } from './use-chat'

export const START_FAILED_MESSAGE = 'The conversation could not be started. Try again.'

export interface StartChat {
  start: (text: string) => void
  startAbout: (subject: ChatThreadSubject) => Promise<void>
  starting: boolean
  notice: string | null
}

export function useStartChat(onFailure?: () => void): StartChat {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [starting, setStarting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const inFlight = useRef<AbortController | null>(null)

  useEffect(() => () => inFlight.current?.abort(), [])

  const begin = useCallback(
    (subject: ChatThreadSubject | undefined, firstTurn: string | null): Promise<void> => {
      if (inFlight.current) return Promise.resolve()
      const controller = new AbortController()
      inFlight.current = controller
      setStarting(true)
      setNotice(null)
      let threadId: string | null = null
      return createThread(subject, controller.signal)
        .then(async (thread) => {
          threadId = thread.id
          if (firstTurn !== null) await postTurn(thread.id, firstTurn, controller.signal)
          void queryClient.invalidateQueries({ queryKey: CHAT_THREADS_KEY })
          router.push(`/chat/${thread.id}`)
        })
        .catch(async () => {
          if (threadId) await deleteThread(threadId).catch(() => undefined)
          if (controller.signal.aborted) return
          inFlight.current = null
          setNotice(START_FAILED_MESSAGE)
          setStarting(false)
          onFailure?.()
        })
    },
    [router, queryClient, onFailure]
  )

  const start = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (trimmed) void begin(undefined, trimmed)
    },
    [begin]
  )

  const startAbout = useCallback((subject: ChatThreadSubject) => begin(subject, null), [begin])

  return { start, startAbout, starting, notice }
}
