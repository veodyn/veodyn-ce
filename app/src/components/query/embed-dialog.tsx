'use client'

import { useId, useState } from 'react'
import { Link2, Link2Off } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { InputWithCopy } from '@/components/shared/input-with-copy'
import { LinkExpiryField, toExpiresAt } from '@/components/shared/link-expiry-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useShareVisualization, useUnshareVisualization } from '@/hooks/use-visualizations'
import { usePolicy } from '@/lib/policy'
import { embedPublicPath, publicLinkUrl } from '@/lib/public-links'
import { USE_REAL_API } from '@/services/redash/config'

interface EmbedDialogProps {
  open: boolean
  onClose: () => void
  visualizationId: number
  isSafe: boolean
  /**
   * The share token this visualization already carries, from
   * `visualization.api_key` on the owning query. Redash sends it only to an
   * admin or the query's owner, so null means either no link exists or the
   * caller may not read it back. Without it every open offers "Create embed
   * link" and each click mints a second live token that revoking never reaches.
   */
  shareToken?: string | null
}

/**
 * What an embed link is: a per-visualization share token, minted the way a
 * dashboard share link is, resolved anonymously by /embed/public/<token>. The
 * token is the whole of what an embed grants (one visualization, one result),
 * and revoking it kills every copy of the snippet at once.
 */
export function EmbedDialog({
  open,
  onClose,
  visualizationId,
  isSafe,
  shareToken = null,
}: EmbedDialogProps) {
  const [width, setWidth] = useState('720')
  const [height, setHeight] = useState('391')
  const [expiry, setExpiry] = useState('')
  // Null until this dialog mints or revokes something, and authoritative after:
  // the prop cannot tell us about a token that was created a second ago, and a
  // revoke has to win over a prop the parent has not refetched yet.
  const [minted, setMinted] = useState<{ token: string | null } | null>(null)
  const widthId = useId()
  const heightId = useId()

  const share = useShareVisualization()
  const unshare = useUnshareVisualization()
  const canPublish = usePolicy().canPublishVisualization()

  const token = minted ? minted.token : shareToken
  const publicUrl = token ? publicLinkUrl(embedPublicPath(token)) : ''
  const iframeCode = `<iframe src="${publicUrl}" width="${width}" height="${height}" frameborder="0"></iframe>`

  // Stated rather than drawn as a disabled button that never says why.
  const blockedReason = !canPublish
    ? 'You do not have permission to publish this visualization. An administrator can grant publish_visualization to your group.'
    : !USE_REAL_API
      ? 'Creating an embed link needs a connected backend. Without one the link would resolve to an empty page.'
      : null

  const failure = share.error ?? unshare.error
  const busy = share.isPending || unshare.isPending

  const handleOpenChange = (next: boolean) => {
    if (!next) onClose()
  }

  const createLink = () => {
    share.mutate(
      { vizId: visualizationId, expiresAt: toExpiresAt(expiry) },
      { onSuccess: (result) => setMinted({ token: result.api_key }) }
    )
  }

  const revokeLink = () => {
    unshare.mutate(visualizationId, { onSuccess: () => setMinted({ token: null }) })
  }

  if (!isSafe) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        {/* size="md" is the wrapper's own default, one step wider than
            DialogContent's sm. */}
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Embed Visualization</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-destructive">
            This query uses text parameters and cannot be embedded for security reasons.
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Embed Visualization</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto">
          {token ? (
            <>
              <InputWithCopy label="Public URL" value={publicUrl} />
              <p className="text-xs text-muted-foreground">
                Anyone holding this link can see this visualization and its latest result,
                without signing in.
              </p>
              <div className="flex gap-3">
                <div>
                  <Label htmlFor={widthId} className="mb-1 block">Width</Label>
                  <Input
                    id={widthId}
                    type="number"
                    value={width}
                    onChange={(e) => setWidth(e.target.value)}
                    className="w-24 h-8"
                  />
                </div>
                <div>
                  <Label htmlFor={heightId} className="mb-1 block">Height</Label>
                  <Input
                    id={heightId}
                    type="number"
                    value={height}
                    onChange={(e) => setHeight(e.target.value)}
                    className="w-24 h-8"
                  />
                </div>
              </div>
              <InputWithCopy label="IFrame Code" value={iframeCode} />
              {/* Only what this session asked for: a token that arrived on a
                  prop carries no expiry we know about. */}
              {minted && expiry ? (
                <p className="text-xs text-muted-foreground">
                  This link stops working on {new Date(expiry).toLocaleString()}.
                </p>
              ) : null}
              {canPublish ? (
                <Button variant="destructive" disabled={busy} onClick={revokeLink}>
                  <Link2Off data-icon="inline-start" />
                  Revoke embed link
                </Button>
              ) : null}
            </>
          ) : blockedReason ? (
            <p className="text-sm text-muted-foreground">{blockedReason}</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                This visualization has no embed link yet. Creating one makes it readable by
                anyone holding the link, with no sign-in.
              </p>
              <LinkExpiryField value={expiry} onChange={setExpiry} disabled={busy} />
              <Button disabled={busy} onClick={createLink}>
                <Link2 data-icon="inline-start" />
                Create embed link
              </Button>
            </>
          )}
          {failure ? (
            <p className="text-sm text-destructive">
              {failure instanceof Error ? failure.message : 'The embed link could not be updated.'}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
