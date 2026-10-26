'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { ChatHome } from '@/components/chat/chat-home'
import { ChatShell } from '@/components/chat/chat-shell'
import { subjectFromSearch } from '@/lib/chat/subject-href'

export default function ChatPage() {
  return (
    <ChatShell activeId={null}>
      <Suspense>
        <ChatHomeFromAddress />
      </Suspense>
    </ChatShell>
  )
}

function ChatHomeFromAddress() {
  return <ChatHome subject={subjectFromSearch(useSearchParams())} />
}
