'use client'

import { useId, useState } from 'react'
import { ExternalLink, Link2, Link2Off } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { InputWithCopy } from '@/components/shared/input-with-copy'
import { LinkExpiryField, toExpiresAt } from '@/components/shared/link-expiry-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useShareVisualization, useUnshareVisualization } from '@/hooks/use-visualizations'
import { usePolicy } from '@/lib/policy'
import { embedPublicPath, publicLinkUrl } from '@/lib/public-links'
import { USE_REAL_API } from '@/services/redash/config'

/**
 * The refresh cadences a published link can carry, as `?refresh=` seconds.
 * '' is "never": the page fetches once, which is what a link pasted into a
 * document wants. The default is a minute, because the audience of a published
 * link is a screen nobody reloads, and a frozen board looks exactly like a
 * working one until someone misses their bus.
 *
 * The cadence re-reads the query's latest STORED result; it never runs the
 * query. Fresh numbers therefore need the query itself on a schedule, which is
 * why the dialog says so right under this control.
 */
const REFRESH_CHOICES = [
  { value: '', label: 'Never' },
  { value: '30', label: 'Every 30 seconds' },
  { value: '60', label: 'Every minute' },
  { value: '300', label: 'Every 5 minutes' },
  { value: '900', label: 'Every 15 minutes' },
] as const

export const DEFAULT_REFRESH_SECONDS = '60'

interface EmbedDialogProps {
  open: boolean
  onClose: () => void
  visualizationId: number
  /**
   * The query owning the visualization. A mint or revoke settles onto that
   * query's cache entry (see settleShareToken in use-visualizations.ts), which
   * is where the token survives this dialog closing.
   */
  queryId: number
  isSafe: boolean
  /**
   * The share token this visualization already carries, from
   * `visualization.api_key` on the owning query. The backend attaches it only
   * for an admin or the query's owner, so null means either no link exists or
   * the caller may not read it back. Without it every open offers "Create
   * embed link", and each Create resets the terms of the one idempotent token:
   * a click with the expiry field empty clears the expiry the link had.
   */
  shareToken?: string | null
}

/**
 * What a published link is: a per-visualization share token, minted the way a
 * dashboard share link is, resolved anonymously by /embed/public/<token>. The
 * token is the whole of what publishing grants (one visualization, one
 * result), and revoking it kills every copy of the link at once: the iframe
 * in a document and the webview on a wall screen alike.
 */
export function EmbedDialog({
  open,
  onClose,
  visualizationId,
  queryId,
  isSafe,
  shareToken = null,
}: EmbedDialogProps) {
  const [width, setWidth] = useState('720')
  const [height, setHeight] = useState('391')
  const [expiry, setExpiry] = useState('')
  const [refresh, setRefresh] = useState<string>(DEFAULT_REFRESH_SECONDS)
  // Null until this dialog mints or revokes something, and authoritative after:
  // `shareToken` is read off the visualization object captured when the dialog
  // opened, so within this open it cannot learn about a mint or revoke, however
  // current the query cache is. The next open reads the settled cache instead.
  const [minted, setMinted] = useState<{ token: string | null } | null>(null)
  const widthId = useId()
  const heightId = useId()
  const refreshId = useId()

  const share = useShareVisualization()
  const unshare = useUnshareVisualization()
  const canPublish = usePolicy().canPublishVisualization()

  const token = minted ? minted.token : shareToken
  // The cadence rides the URL, not the token: two screens can hold the same
  // link at two speeds, and changing the cadence is re-copying a URL rather
  // than re-publishing anything.
  const publicUrl = token
    ? publicLinkUrl(embedPublicPath(token)) + (refresh ? `?refresh=${refresh}` : '')
    : ''
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
      { vizId: visualizationId, queryId, expiresAt: toExpiresAt(expiry) },
      { onSuccess: (result) => setMinted({ token: result.api_key }) }
    )
  }

  const revokeLink = () => {
    unshare.mutate(
      { vizId: visualizationId, queryId },
      { onSuccess: () => setMinted({ token: null }) }
    )
  }

  if (!isSafe) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        {/* size="md" is the wrapper's own default, one step wider than
            DialogContent's sm. */}
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Publish Visualization</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-destructive">
            This query uses text parameters and cannot be published for security reasons.
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Publish Visualization</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto">
          {token ? (
            <>
              <InputWithCopy label="Public URL" value={publicUrl} />
              <p className="text-xs text-muted-foreground">
                Anyone holding this link can see this visualization and its latest result,
                without signing in. The page fills whatever window or webview opens it.
              </p>
              <div>
                <Label htmlFor={refreshId} className="mb-1 block">
                  Refresh on screen
                </Label>
                <Select
                  value={refresh}
                  onValueChange={(v) => {
                    if (v != null) setRefresh(v)
                  }}
                >
                  <SelectTrigger id={refreshId} className="h-9 w-full max-w-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REFRESH_CHOICES.map((choice) => (
                      <SelectItem key={choice.value} value={choice.value}>
                        {choice.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">
                  How often the published page re-reads the latest result. It never runs the
                  query itself, so put the query on a schedule to keep the numbers moving.
                </p>
              </div>
              <Button
                variant="outline"
                render={<a href={publicUrl} target="_blank" rel="noreferrer" />}
              >
                <ExternalLink data-icon="inline-start" />
                Open full screen
              </Button>
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
                  Revoke public link
                </Button>
              ) : null}
            </>
          ) : blockedReason ? (
            <p className="text-sm text-muted-foreground">{blockedReason}</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                This visualization has no public link yet. Creating one makes it readable by
                anyone holding the link, with no sign-in.
              </p>
              <LinkExpiryField value={expiry} onChange={setExpiry} disabled={busy} />
              <Button disabled={busy} onClick={createLink}>
                <Link2 data-icon="inline-start" />
                Create public link
              </Button>
            </>
          )}
          {failure ? (
            <p className="text-sm text-destructive">
              {failure instanceof Error ? failure.message : 'The public link could not be updated.'}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
