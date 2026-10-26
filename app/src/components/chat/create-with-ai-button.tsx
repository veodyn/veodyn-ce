'use client'

import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAiChatEnabled } from '@/hooks/use-chat'
import { useOpenChatAbout } from '@/hooks/use-start-chat'
import type { NewThreadKind } from '@/lib/chat/wire'
import { useDiscardGate } from './use-discard-gate'

export interface CreateWithAiButtonProps {
  kind: NewThreadKind
  isDirty?: boolean
}

export function CreateWithAiButton({ kind, isDirty = false }: CreateWithAiButtonProps) {
  const enabled = useAiChatEnabled()
  const openAbout = useOpenChatAbout()
  const { gate, dialog } = useDiscardGate(isDirty)

  if (!enabled) return null

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => gate(() => openAbout({ kind: 'new', newKind: kind }))}
      >
        <Sparkles aria-hidden="true" />
        Create with AI
      </Button>
      {dialog}
    </>
  )
}
