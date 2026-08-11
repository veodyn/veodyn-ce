'use client'

import { useId, useState } from 'react'
import { Eye, EyeOff, RefreshCw, Copy, Check } from 'lucide-react'

import { useRegenerateApiKey } from '@/hooks/use-profile'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { IconButton } from '@/components/shared/icon-button'
import { useToast } from '@/components/shared/toast-provider'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import type { RedashUserDetail } from './user-detail-types'

// ---------------------------------------------------------------------------
// API key panel: masked key display with reveal/copy/regenerate. Extracted
// out of admin-user-detail-security.tsx so the profile page can compose the
// same implementation for a user's own key.
// ---------------------------------------------------------------------------

interface ApiKeyPanelProps {
  userId: string
  apiKey: string
  canRegenerate: boolean
  onRegenerated: (user: RedashUserDetail) => void
}

export function ApiKeyPanel({ userId, apiKey, canRegenerate, onRegenerated }: ApiKeyPanelProps) {
  const toast = useToast()
  const regenerate = useRegenerateApiKey(Number(userId))
  // Generated, not a constant: the profile page and the admin detail page both
  // compose this panel, and a hardcoded id would collide the moment two of
  // them ever share a document.
  const labelId = useId()
  const [showApiKey, setShowApiKey] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirmingRegenerate, setConfirmingRegenerate] = useState(false)

  const handleRegenerateApiKey = async () => {
    try {
      onRegenerated(await regenerate.mutateAsync())
      toast.success('API key regenerated')
    } catch {
      toast.error('Failed to regenerate API key')
    } finally {
      setConfirmingRegenerate(false)
    }
  }

  const handleCopyApiKey = async () => {
    if (!apiKey) return
    await navigator.clipboard.writeText(apiKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    // The invite link a few rows down toasts when it is copied. The same
    // gesture reporting two different ways reads as one of them having failed.
    toast.success('API key copied')
  }

  return (
    <div>
      {/* The key renders as <code>, which a <label> cannot own, so the name is
          attached to the group of controls instead of to a htmlFor pointing at
          something that can never take focus. */}
      <Label id={labelId} className="text-xs text-muted-foreground block mb-1">
        API Key
      </Label>
      {/* Capped for the same reason as the account fields: the key is a fixed
          40 characters, so a field the width of the page is all padding. */}
      <div className="flex max-w-xl items-center gap-2 mt-1">
        {/* No overflow-hidden: the buttons are square-cornered already, and
            clipping the box would cut off their focus rings. */}
        <div
          role="group"
          aria-labelledby={labelId}
          className="flex-1 flex items-center gap-0 rounded-md border bg-muted"
        >
          <code className="flex-1 px-3 py-2 font-mono text-xs text-muted-foreground truncate">
            {showApiKey ? apiKey : '•'.repeat(20)}
          </code>
          {/* size-3.5 rather than h-3.5 w-3.5: Button sizes any icon that does
              not already carry a size- class up to 16px. */}
          <IconButton
            tooltip={showApiKey ? 'Hide API key' : 'Show API key'}
            variant="ghost"
            size="icon"
            onClick={() => setShowApiKey(!showApiKey)}
            className="rounded-none border-l-border text-muted-foreground"
          >
            {showApiKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </IconButton>
          <IconButton
            tooltip={copied ? 'Copied' : 'Copy API key'}
            aria-label="Copy API key"
            variant="ghost"
            size="icon"
            onClick={handleCopyApiKey}
            className="rounded-none rounded-r-md border-l-border text-muted-foreground"
          >
            {copied ? (
              <Check className="size-3.5 text-status-fresh" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </IconButton>
        </div>
        {canRegenerate && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmingRegenerate(true)}
            className="shrink-0"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Regenerate
          </Button>
        )}
      </div>

      {/* Was a native confirm(): it blocks the whole tab, cannot be styled, and
          on the profile page it is the only modal on the screen that does not
          look like the app. */}
      <ConfirmDialog
        open={confirmingRegenerate}
        onOpenChange={setConfirmingRegenerate}
        title="Regenerate API key?"
        description="The old key stops working immediately. Anything already using it, a script or an MCP connection, has to be given the new one."
        confirmLabel="Regenerate"
        isPending={regenerate.isPending}
        onConfirm={handleRegenerateApiKey}
      />
    </div>
  )
}
