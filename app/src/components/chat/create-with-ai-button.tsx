'use client'

import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/shared/toast-provider'
import { useAiChatEnabled } from '@/hooks/use-chat'
import { START_FAILED_MESSAGE, useStartChat } from '@/hooks/use-start-chat'
import type { NewThreadKind } from '@/lib/chat/wire'
import { useDiscardGate } from './use-discard-gate'

export interface CreateWithAiButtonProps {
  kind: NewThreadKind
  isDirty?: boolean
}

export function CreateWithAiButton({ kind, isDirty = false }: CreateWithAiButtonProps) {
  const enabled = useAiChatEnabled()
  const toast = useToast()
  const { startAbout, starting } = useStartChat(() => toast.error(START_FAILED_MESSAGE))

  const { gate, dialog } = useDiscardGate(isDirty)

  if (!enabled) return null

  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={starting}
        onClick={() => gate(() => void startAbout({ kind: 'new', newKind: kind }))}
      >
        <Sparkles aria-hidden="true" />
        Create with AI
      </Button>
      {dialog}
    </>
  )
}
