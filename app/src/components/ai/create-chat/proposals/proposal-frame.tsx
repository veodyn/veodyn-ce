'use client'

// The chrome every proposal card wears: a titled card, the editable fields as
// children, a failed create kept visible, and the one button that writes
// anything. Shared so each card file is its own fields and its own commit and
// nothing else, and so the busy state reads the same on all five.
import type { ReactNode } from 'react'
import { AlertCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

interface ProposalFrameProps {
  title: string
  description: string
  /** The button's label when idle; "Creating ..." is derived from it. */
  createLabel: string
  busy: boolean
  /** Rendered inline; the proposal stays on screen beside it. */
  error: string | null
  /** False when a required field is still missing. Defaults to true. */
  canCreate?: boolean
  onCreate: () => void
  children: ReactNode
}

export function ProposalFrame({
  title,
  description,
  createLabel,
  busy,
  error,
  canCreate = true,
  onCreate,
  children,
}: ProposalFrameProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-balance text-lg">{title}</CardTitle>
        <CardDescription className="text-pretty">{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {children}

        {error != null && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="text-pretty">{error}</span>
          </div>
        )}

        <div className="flex justify-end pt-2">
          {/* aria-busy rather than a spinner alone: a disabled button with a
              swapped icon says nothing to a screen reader about why. */}
          <Button
            type="button"
            onClick={onCreate}
            disabled={busy || !canCreate}
            aria-busy={busy}
          >
            {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
            {busy ? `Creating ${createLabel.replace(/^Create /, '')}` : createLabel}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
