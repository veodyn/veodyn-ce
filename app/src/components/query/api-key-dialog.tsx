'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { InputWithCopy } from '@/components/shared/input-with-copy'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/shared/toast-provider'
import { useRegenerateQueryApiKey } from '@/hooks/use-queries'

interface ApiKeyDialogProps {
  open: boolean
  onClose: () => void
  queryId: number
  /**
   * The query's own key, from `query.api_key`. Undefined when the backend did
   * not return one, which is not the same as an empty key and must not be
   * papered over: this dialog used to be handed `query.user.email`, so it
   * displayed the author's address under an "API Key" label and the copy
   * button put an email address on the clipboard.
   */
  apiKey: string | undefined
}

export function ApiKeyDialog({ open, onClose, queryId, apiKey }: ApiKeyDialogProps) {
  const [confirming, setConfirming] = useState(false)
  const toast = useToast()
  const regenerate = useRegenerateQueryApiKey()

  // Two steps, because rotating the key breaks every URL already built from
  // it and there is no undo.
  const handleRegenerate = () => {
    if (!confirming) {
      setConfirming(true)
      return
    }
    setConfirming(false)
    regenerate.mutate(queryId, {
      onSuccess: () => toast.success('API key regenerated. Any URL using the old key has stopped working.'),
      onError: () =>
        toast.error('Could not regenerate the key. You must own this query, or be an admin.'),
    })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Query API Key</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto">
          {apiKey ? (
            <>
              <InputWithCopy label="API Key" value={apiKey} />
              <p className="text-xs text-muted-foreground">
                Use this key to access this query&apos;s results via the API.
              </p>
              <div className="flex justify-end">
                <Button
                  variant="destructive"
                  onClick={handleRegenerate}
                  disabled={regenerate.isPending}
                >
                  {confirming ? 'Click again to confirm' : 'Regenerate'}
                </Button>
              </div>
            </>
          ) : (
            // Say what is true rather than showing an empty box or substituting
            // some other value that happens to be to hand. With no key there is
            // also nothing to rotate, so no control is offered.
            <p className="text-sm text-muted-foreground">
              This query has no API key. Save the query and reload; if it still has
              none, your Redash instance does not issue per-query keys.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
