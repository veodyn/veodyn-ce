'use client'

import { MessagesSquare } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { BigMessage } from '@/components/shared/big-message'
import { createThread, postTurn } from '@/services/ai/chat-client'
import { ChatComposer } from './chat-composer'

export const START_FAILED_MESSAGE = 'The conversation could not be started. Try again.'

export function ChatHome() {
  const router = useRouter()
  const [starting, setStarting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const start = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || starting) return
    setStarting(true)
    setNotice(null)
    createThread()
      .then(async (thread) => {
        await postTurn(thread.id, trimmed)
        router.push(`/chat/${thread.id}`)
      })
      .catch(() => {
        setNotice(START_FAILED_MESSAGE)
        setStarting(false)
      })
  }

  return (
    <div className="flex h-full w-full max-w-3xl flex-col justify-center gap-6 px-6 py-10">
      <BigMessage
        icon={<MessagesSquare className="size-10" aria-hidden="true" />}
        message="Ask anything about your data"
        className="py-0"
      >
        <p className="text-pretty text-sm text-muted-foreground">
          Questions are answered by running read-only queries in your browser, with your own permissions. Results
          you want to keep can be saved as queries.
        </p>
      </BigMessage>
      <ChatComposer
        onSend={start}
        disabled={starting}
        sending={starting}
        notice={notice}
        placeholder="Which routes lost the most riders this month?"
      />
    </div>
  )
}
