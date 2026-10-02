'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createThread, deleteThread, postTurn } from '@/services/ai/chat-client'
import { CHAT_THREADS_KEY } from './use-chat'

export const START_FAILED_MESSAGE = 'The conversation could not be started. Try again.'

export interface StartChat {
  start: (text: string) => void
  starting: boolean
  notice: string | null
}

export function useStartChat(): StartChat {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [starting, setStarting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const inFlight = useRef<AbortController | null>(null)

  useEffect(() => () => inFlight.current?.abort(), [])

  const start = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || inFlight.current) return
      const controller = new AbortController()
      inFlight.current = controller
      setStarting(true)
      setNotice(null)
      let threadId: string | null = null
      createThread(controller.signal)
        .then(async (thread) => {
          threadId = thread.id
          await postTurn(thread.id, trimmed, controller.signal)
          void queryClient.invalidateQueries({ queryKey: CHAT_THREADS_KEY })
          router.push(`/chat/${thread.id}`)
        })
        .catch(async () => {
          if (threadId) await deleteThread(threadId).catch(() => undefined)
          if (controller.signal.aborted) return
          inFlight.current = null
          setNotice(START_FAILED_MESSAGE)
          setStarting(false)
        })
    },
    [router, queryClient]
  )

  return { start, starting, notice }
}
