'use client'

// The editing-toolbar counterpart to CreateWithAiButton: same conversation,
// pointed at a dashboard that already exists rather than at a blank one.
//
// It renders nothing at all when AI is off, not a disabled control. That is the
// rule every AI affordance in this product follows and the thing the
// ai-editor and ai-report-flow e2e specs assert by sweeping the page for one.
import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAiEnabled } from '@/hooks/use-ai'
import { CreateChatDialog } from './create-chat-dialog'

export interface EditWithAiButtonProps {
  dashboardId: number
}

export function EditWithAiButton({ dashboardId }: EditWithAiButtonProps) {
  const enabled = useAiEnabled()
  const [open, setOpen] = useState(false)

  if (!enabled) return null

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Sparkles aria-hidden="true" />
        Edit with AI
      </Button>
      {/* Mounted only while open, because unmounting is how the conversation
          is discarded: it has no persistence anywhere. */}
      {open && (
        <CreateChatDialog
          kind="dashboard"
          targetDashboardId={dashboardId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
