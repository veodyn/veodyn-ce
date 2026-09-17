'use client'

import { ChatHome } from '@/components/chat/chat-home'
import { ChatShell } from '@/components/chat/chat-shell'

export default function ChatPage() {
  return (
    <ChatShell activeId={null}>
      <ChatHome />
    </ChatShell>
  )
}
