'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import { createThread, postTurn } from '@/services/ai/chat-client'
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

  const start = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || starting) return
      setStarting(true)
      setNotice(null)
      createThread()
        .then(async (thread) => {
          await postTurn(thread.id, trimmed)
          void queryClient.invalidateQueries({ queryKey: CHAT_THREADS_KEY })
          router.push(`/chat/${thread.id}`)
        })
        .catch(() => {
          setNotice(START_FAILED_MESSAGE)
          setStarting(false)
        })
    },
    [starting, router, queryClient]
  )

  return { start, starting, notice }
}
