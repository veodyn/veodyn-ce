'use client'

import { useId, useState } from 'react'
import { Mail, Lock, Info, Copy } from 'lucide-react'

import { redashApi } from '@/services/api-client'
import { toLocalLink } from '@/lib/link-utils'
import { useToast } from '@/components/shared/toast-provider'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/shared/icon-button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiKeyPanel } from './api-key-panel'
import { ChangePasswordDialog } from './change-password-dialog'
import type { RedashUserDetail } from './user-detail-types'
import { SUBSECTION_HEADING } from '@/lib/section-heading'

// ---------------------------------------------------------------------------
// Security card: API key, password change/reset, and the invite/reset link
// banner. Extracted from admin-user-detail.tsx to keep that file under the
// file-size seam; owns its own local UI state (the change-password dialog)
// and reports account-wide updates back to the parent (refreshed user
// record, invite link) via callbacks.
//

interface AdminUserDetailSecurityProps {
  userId: string
  user: RedashUserDetail
  isOwnProfile: boolean
  isAdmin: boolean
  canEdit: boolean
  inviteLink: string | null
  onInviteLinkChange: (link: string | null) => void
  onUserChange: (user: RedashUserDetail) => void
}

export function AdminUserDetailSecurity({
  userId,
  user,
  isOwnProfile,
  isAdmin,
  canEdit,
  inviteLink,
  onInviteLinkChange,
  onUserChange,
}: AdminUserDetailSecurityProps) {
  const toast = useToast()
  const passwordLabelId = useId()
  const [showPasswordDialog, setShowPasswordDialog] = useState(false)

  const handlePasswordReset = async () => {
    try {
      const result = await redashApi.post<{ reset_link: string }>(
        `users/${userId}/reset_password`
      )
      onInviteLinkChange(toLocalLink(result.reset_link))
      toast.success('Password reset link ready. Share it with the user.')
    } catch {
      toast.error('Failed to send password reset')
    }
  }

  const handleResendInvitation = async () => {
    try {
      const result = await redashApi.post<{ invite_link?: string }>(`users/${userId}/invite`)
      if (result.invite_link) {
        onInviteLinkChange(toLocalLink(result.invite_link))
      }
      toast.success('Invitation link ready. Share it with the user.')
    } catch {
      toast.error('Failed to resend invitation')
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Lock className="h-4 w-4 text-muted-foreground" />
          <h3 className={SUBSECTION_HEADING}>Security</h3>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <ApiKeyPanel
          userId={userId}
          apiKey={user.api_key}
          canRegenerate={canEdit}
          onRegenerated={onUserChange}
        />

        <div className="pt-3 border-t">
          {/* What sits under this label is a button, whose own name already says
              what it does, so the label names the group rather than claiming a
              control it does not own. */}
          <Label id={passwordLabelId} className="text-xs text-muted-foreground block mb-1.5">
            Password
          </Label>
          <div role="group" aria-labelledby={passwordLabelId}>
            {isOwnProfile ? (
              <Button variant="outline" size="sm" onClick={() => setShowPasswordDialog(true)}>
                <Lock className="h-3.5 w-3.5" />
                Change Password
              </Button>
            ) : user.is_invitation_pending ? (
              <Button variant="outline" size="sm" onClick={handleResendInvitation}>
                <Mail className="h-3.5 w-3.5" />
                Resend Invitation
              </Button>
            ) : isAdmin ? (
              <Button variant="outline" size="sm" onClick={handlePasswordReset}>
                <Mail className="h-3.5 w-3.5" />
                Send Password Reset Email
              </Button>
            ) : null}
          </div>
        </div>

        {inviteLink && (
          <div className="rounded-md border border-primary/30 bg-primary/10 p-3">
            <div className="flex items-start gap-2 mb-2">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-primary" />
              <p className="text-sm text-muted-foreground">
                {user.is_invitation_pending
                  ? 'Share this link with the user to complete registration:'
                  : 'Share this link with the user to reset their password:'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input readOnly value={inviteLink} className="flex-1 text-xs font-mono" />
              {/* Had no name of any kind: a bare copy glyph beside a long URL,
                  invisible to a screen reader and unexplained to everyone
                  else. */}
              <IconButton
                tooltip="Copy link"
                variant="outline"
                size="sm"
                onClick={async () => {
                  await navigator.clipboard.writeText(inviteLink)
                  toast.success('Link copied')
                }}
              >
                <Copy className="h-3.5 w-3.5" />
              </IconButton>
            </div>
          </div>
        )}

        <ChangePasswordDialog
          userId={userId}
          open={showPasswordDialog}
          onClose={() => setShowPasswordDialog(false)}
        />
      </CardContent>
    </Card>
  )
}
