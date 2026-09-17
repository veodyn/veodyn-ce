'use client'

import { MessagesSquare } from 'lucide-react'
import type { ReactNode } from 'react'
import { BigMessage } from '@/components/shared/big-message'
import { useAiChatEnabled } from '@/hooks/use-chat'
import { ThreadList } from './thread-list'

export const CHAT_OFF_MESSAGE = 'The data chat is not turned on for this instance.'

export function ChatShell({ activeId, children }: { activeId: string | null; children: ReactNode }) {
  const enabled = useAiChatEnabled()
  if (!enabled) {
    return <BigMessage icon={<MessagesSquare className="size-10" aria-hidden="true" />} message={CHAT_OFF_MESSAGE} />
  }
  return (
    <div className="flex h-screen min-h-0">
      <div className="w-64 shrink-0 border-r bg-sidebar/40">
        <ThreadList activeId={activeId} />
      </div>
      <div aria-label="Data chat" className="min-w-0 flex-1">
        {children}
      </div>
    </div>
  )
}
