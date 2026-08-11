'use client'

// The one entry point every library page adds beside its New X button. It owns
// the open state so a page adds a single line, and it renders nothing at all
// when AI is off: no affordance, not a disabled one (spec section 2).
import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAiEnabled } from '@/hooks/use-ai'
import type { CreateKind } from '@/types/ai-create'
import { CreateChatDialog } from './create-chat-dialog'

export interface CreateWithAiButtonProps {
  kind: CreateKind
}

export function CreateWithAiButton({ kind }: CreateWithAiButtonProps) {
  const enabled = useAiEnabled()
  const [open, setOpen] = useState(false)

  if (!enabled) return null

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Sparkles aria-hidden="true" />
        Create with AI
      </Button>
      {/* Mounted only while open: the conversation has no persistence, so
          unmounting it is how closing discards it. */}
      {open && <CreateChatDialog kind={kind} onClose={() => setOpen(false)} />}
    </>
  )
}
