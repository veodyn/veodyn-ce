'use client'

import { useId, useState } from 'react'
import { Send } from 'lucide-react'

import { redashApi } from '@/services/api-client'
import { toLocalLink } from '@/lib/link-utils'
import { useToast } from '@/components/shared/toast-provider'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { InputWithCopy } from '@/components/shared/input-with-copy'

interface InviteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onInvited: () => void
}

export function InviteDialog({ open, onOpenChange, onInvited }: InviteDialogProps) {
  const toast = useToast()
  const nameId = useId()
  const emailId = useId()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [emailSent, setEmailSent] = useState(false)

  const handleSend = async () => {
    if (!name.trim() || !email.trim()) {
      toast.error('Name and email are required')
      return
    }
    setIsSending(true)
    try {
      const result = await redashApi.post<{ invite_link?: string; email_sent?: boolean }>(
        'users',
        { name, email }
      )
      setInviteLink(result.invite_link ? toLocalLink(result.invite_link) : null)
      setEmailSent(result.email_sent ?? false)
      onInvited()
    } catch {
      toast.error('Failed to create user')
    } finally {
      setIsSending(false)
    }
  }

  const resetAndClose = () => {
    setName('')
    setEmail('')
    setInviteLink(null)
    setEmailSent(false)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) resetAndClose() }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>New User</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto">
          {inviteLink !== null ? (
            <div className="space-y-3 py-2">
              <p className="text-sm text-muted-foreground">
                User created. Share this invite link so they can set their password.
                {emailSent ? ' An invitation email was also sent.' : ''}
              </p>
              <InputWithCopy value={inviteLink} />
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                Create a new user account and get an invite link to share directly.
              </p>
              <div>
                <Label htmlFor={nameId} className="mb-1 block">
                  Name
                </Label>
                <Input
                  id={nameId}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="John Doe"
                />
              </div>
              <div>
                <Label htmlFor={emailId} className="mb-1 block">
                  Email
                </Label>
                <Input
                  id={emailId}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="user@example.com"
                />
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          {inviteLink ? (
            <Button onClick={resetAndClose}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={resetAndClose}>
                Cancel
              </Button>
              <Button onClick={handleSend} disabled={isSending}>
                <Send className="h-3.5 w-3.5" />
                {isSending ? 'Creating...' : 'Create'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
