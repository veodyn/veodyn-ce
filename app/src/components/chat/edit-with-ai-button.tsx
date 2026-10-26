'use client'

import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAiChatEnabled } from '@/hooks/use-chat'
import { useOpenChatAbout } from '@/hooks/use-start-chat'
import { useDiscardGate } from './use-discard-gate'

export interface EditWithAiButtonProps {
  dashboardId: number
  isDirty?: boolean
}

export function EditWithAiButton({ dashboardId, isDirty = false }: EditWithAiButtonProps) {
  const enabled = useAiChatEnabled()
  const openAbout = useOpenChatAbout()
  const { gate, dialog } = useDiscardGate(isDirty)

  if (!enabled) return null

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => gate(() => openAbout({ kind: 'dashboard', dashboardId }))}
      >
        <Sparkles aria-hidden="true" />
        Edit with AI
      </Button>
      {dialog}
    </>
  )
}
