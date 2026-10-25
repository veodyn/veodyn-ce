'use client'

import { useState, type ReactNode } from 'react'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'

export function useDiscardGate(isDirty: boolean): { gate: (action: () => void) => void; dialog: ReactNode } {
  const [pending, setPending] = useState<(() => void) | null>(null)

  const gate = (action: () => void) => {
    if (isDirty) setPending(() => action)
    else action()
  }

  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) setPending(null)
      }}
      title="Leave without saving?"
      description="This page has changes that have not been saved. Leaving now discards them."
      confirmLabel="Discard changes"
      cancelLabel="Keep editing"
      onConfirm={() => {
        const action = pending
        setPending(null)
        action?.()
      }}
    />
  )

  return { gate, dialog }
}
