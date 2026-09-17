'use client'

import { useParams } from 'next/navigation'
import { ChatShell } from '@/components/chat/chat-shell'
import { ChatThreadView } from '@/components/chat/chat-thread-view'

export default function ChatThreadPage() {
  const { id } = useParams<{ id: string }>()
  return (
    <ChatShell activeId={id}>
      <ChatThreadView key={id} threadId={id} />
    </ChatShell>
  )
}
