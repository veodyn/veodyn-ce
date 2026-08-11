'use client'

import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { InputWithCopy } from '@/components/shared/input-with-copy'
import { LinkExpiryField, toExpiresAt } from '@/components/shared/link-expiry-field'
import { Switch } from '@/components/ui/switch'
import { useShareDashboard, useUnshareDashboard } from '@/hooks/use-dashboards'
import { usePolicy } from '@/lib/policy'
import { dashboardPublicPath, publicLinkUrl, shareToken } from '@/lib/public-links'
import { USE_REAL_API } from '@/services/redash/config'
import type { MockDashboard } from '@/lib/mock-data'

interface ShareDashboardDialogProps {
  open: boolean
  onClose: () => void
  dashboard: MockDashboard
}

export function ShareDashboardDialog({ open, onClose, dashboard }: ShareDashboardDialogProps) {
  const shareDashboard = useShareDashboard()
  const unshareDashboard = useUnshareDashboard()
  const canPublish = usePolicy().canPublishDashboard()
  const [expiry, setExpiry] = useState('')
  // Built from this origin, never from the `public_url` Redash sends. That
  // string is on Redash's own configured host, which under Kubernetes is an
  // in-cluster service name that resolves for nobody the link was shared with.
  // See lib/public-links.
  const token = shareToken(dashboard)
  const publicUrl = token ? publicLinkUrl(dashboardPublicPath(token)) : null
  const isPublic = !!token

  // Two reasons this toggle can be unavailable, and they are not the same
  // thing, so they do not share a sentence. The permission one is the rule the
  // Redash fork now enforces on the mint itself, so a user who is told no here
  // would have been told no there too.
  const blockedReason = !canPublish
    ? 'You do not have permission to share this dashboard publicly. An administrator can grant publish_dashboard to your group.'
    : !USE_REAL_API
      ? 'Public sharing needs a connected backend. Without one the link would resolve to an empty page.'
      : null

  const handleToggle = () => {
    if (isPublic) {
      unshareDashboard.mutate(dashboard.id)
    } else {
      shareDashboard.mutate({ id: dashboard.id, expiresAt: toExpiresAt(expiry) })
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Share Dashboard</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Public Access</p>
              <p className="text-xs text-muted-foreground">Anyone with the link can view this dashboard</p>
            </div>
            {/* The shared primitive rather than a second hand-built toggle: this
                one had no focus ring at all, and announced itself as a pressed
                button rather than a switch that is on. */}
            <Switch
              aria-label="Toggle public access"
              checked={isPublic}
              disabled={!!blockedReason}
              onCheckedChange={handleToggle}
            />
          </div>
          {blockedReason && (
            <p className="text-xs text-muted-foreground">{blockedReason}</p>
          )}
          {/* Offered only while there is still a decision to make. Once a link
              exists its expiry was already fixed at mint time, and a field that
              silently changed nothing would be worse than no field. */}
          {!isPublic && !blockedReason && (
            <LinkExpiryField
              value={expiry}
              onChange={setExpiry}
              description="Leave empty for a link that stays open until sharing is turned off."
            />
          )}
          {publicUrl && (
            <>
              <InputWithCopy label="Public URL" value={publicUrl} />
              <div className="flex items-start gap-2 text-xs text-status-stale">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <p>Note: Parameters with text values will be disabled in the shared version for security reasons.</p>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
