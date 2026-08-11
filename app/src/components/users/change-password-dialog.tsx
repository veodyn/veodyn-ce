'use client'

import { useId, useState } from 'react'

import { useChangePassword } from '@/hooks/use-profile'
import { useToast } from '@/components/shared/toast-provider'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// ---------------------------------------------------------------------------
// Change password dialog: extracted out of admin-user-detail-security.tsx so
// the profile page can compose the same implementation for a user's own
// password. Owns its own field state and clears it whenever it closes.
// ---------------------------------------------------------------------------

interface ChangePasswordDialogProps {
  userId: string
  open: boolean
  onClose: () => void
}

export function ChangePasswordDialog({ userId, open, onClose }: ChangePasswordDialogProps) {
  const toast = useToast()
  const changePassword = useChangePassword(Number(userId))
  // Scoped per instance rather than hardcoded: a fixed id would collide the
  // moment two dialogs share a page, and a duplicate id silently breaks the
  // label/input association these fields depend on.
  const fieldId = useId()
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setOldPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setError(null)
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const handlePasswordChange = async () => {
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters')
      toast.error('Password must be at least 6 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match')
      toast.error('Passwords do not match')
      return
    }
    try {
      await changePassword.mutateAsync({ oldPassword, newPassword })
      toast.success('Password changed')
      handleClose()
    } catch {
      setError('Failed to change password. Check your current password.')
      toast.error('Failed to change password. Check your current password.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) handleClose() }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Change Password</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto py-2">
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div>
            <Label htmlFor={`${fieldId}-current`} className="mb-1 block">
              Current Password
            </Label>
            <Input
              id={`${fieldId}-current`}
              type="password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor={`${fieldId}-new`} className="mb-1 block">
              New Password (min 6 characters)
            </Label>
            <Input
              id={`${fieldId}-new`}
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={6}
            />
          </div>
          <div>
            <Label htmlFor={`${fieldId}-confirm`} className="mb-1 block">
              Confirm New Password
            </Label>
            <Input
              id={`${fieldId}-confirm`}
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={handlePasswordChange}
            disabled={!oldPassword || !newPassword || !confirmPassword}
          >
            Change Password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
