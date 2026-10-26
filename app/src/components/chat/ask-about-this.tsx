'use client'

import { MessageSquareText } from 'lucide-react'
import { IconButton } from '@/components/shared/icon-button'
import { useAiChatEnabled } from '@/hooks/use-chat'
import { useDiscardGate } from './use-discard-gate'
import { useOpenChatAbout } from '@/hooks/use-start-chat'
import type { ChatThreadSubject } from '@/lib/chat/wire'

interface AskAboutThisProps {
  subject: ChatThreadSubject
  label: string
  variant?: 'outline' | 'ghost'
  size?: 'icon' | 'icon-sm' | 'icon-xs'
  className?: string
  isDirty?: boolean
}

export function AskAboutThis({ subject, label, variant = 'outline', size = 'icon', className, isDirty = false }: AskAboutThisProps) {
  const enabled = useAiChatEnabled()
  const openAbout = useOpenChatAbout()
  const { gate, dialog } = useDiscardGate(isDirty)

  if (!enabled) return null

  return (
    <>
      <IconButton
        tooltip="Ask about this in chat"
        aria-label={`Ask about ${label} in chat`}
        variant={variant}
        size={size}
        className={className}
        onClick={() => gate(() => openAbout(subject))}
      >
        <MessageSquareText className="h-4 w-4" aria-hidden="true" />
      </IconButton>
      {dialog}
    </>
  )
}
