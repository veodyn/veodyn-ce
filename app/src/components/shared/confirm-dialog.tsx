'use client'

import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: ReactNode
  /** Defaults to "Delete" when destructive, "Confirm" otherwise. */
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  isPending?: boolean
  onConfirm: () => void
}

/**
 * Ask before an action that cannot be undone. Deletes in this product are
 * immediate and have no undo, so the dialog is the only thing standing between
 * a misclick and a lost object.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = true,
  isPending = false,
  onConfirm,
}: ConfirmDialogProps) {
  const label = confirmLabel ?? (destructive ? 'Delete' : 'Confirm')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={isPending} />}>
            {cancelLabel}
          </DialogClose>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? `${label}…` : label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
