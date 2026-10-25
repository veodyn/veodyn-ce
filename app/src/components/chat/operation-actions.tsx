'use client'

import { Check, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useApplyOperation } from '@/hooks/use-apply-operation'
import { isDestructive, type OperationName } from '@/lib/chat/operation-changes'
import { lastApplied } from '@/lib/chat/promotions'
import type { OperationDraftView } from '@/lib/chat/thread-model'
import type { ChatPromotion } from '@/lib/chat/wire'
import { ConflictPrompt } from './conflict-prompt'
import { OperationApplied } from './operation-applied'
import { payloadAt } from './operation-card'
import { UnsyncedNotice } from './unsynced-notice'

export const OPERATION_CONFLICT_MESSAGE = 'This changed after the chat read it. Apply anyway?'
export const FORK_UNFINISHED = 'The copy was made but is still a draft only you can see. Finish lists it like any other query.'

interface OperationActionsProps {
  draft: OperationDraftView
  version: number
  onApplied: (draftId: string, promotion: ChatPromotion) => void
}

function firstLabel(op: OperationName): string {
  return op === 'revoke' ? 'Revoke link' : 'Archive'
}

function confirmLabel(op: OperationName, name: string): string {
  return op === 'revoke' ? `Revoke the link to ${name}, I understand` : `Archive ${name}, I understand`
}

export function OperationActions({ draft, version, onApplied }: OperationActionsProps) {
  const application = useApplyOperation(draft, version, onApplied)
  const [confirming, setConfirming] = useState(false)
  const payload = payloadAt(draft, version)
  const applied = lastApplied(draft.promotions)
  if (!payload) return null
  const destructive = isDestructive(payload)

  if (application.status === 'conflict') {
    return (
      <ConflictPrompt
        message={OPERATION_CONFLICT_MESSAGE}
        overwriteLabel="Apply anyway"
        keepLabel="Leave it"
        onOverwrite={() => application.apply({ confirmed: destructive, overwrite: true })}
        onKeep={application.keep}
      />
    )
  }

  if (application.status === 'unsynced') return <UnsyncedNotice onRetry={application.retrySync} />

  const applying = application.status === 'applying'
  const spinner = applying ? <Loader2 className="animate-spin" aria-hidden="true" /> : null
  return (
    <>
      {applied?.status === 'partial' && payload.op === 'fork' ? (
        <div className="flex w-full flex-col gap-2 text-sm">
          <p className="text-pretty">{FORK_UNFINISHED}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => application.finish(applied)} disabled={applying}>
              {spinner}
              Finish
            </Button>
            <OperationApplied payload={payload} applied={applied} result={application.result} />
          </div>
        </div>
      ) : applied !== undefined ? (
        <OperationApplied payload={payload} applied={applied} result={application.result} />
      ) : destructive && !confirming ? (
        <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
          {firstLabel(payload.op)}
        </Button>
      ) : destructive ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="destructive"
            onClick={() => application.apply({ confirmed: true, overwrite: false })}
            disabled={applying}
          >
            {spinner}
            {confirmLabel(payload.op, payload.target.name)}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setConfirming(false)} disabled={applying}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button size="sm" onClick={() => application.apply({ confirmed: false, overwrite: false })} disabled={applying}>
          {spinner ?? <Check aria-hidden="true" />}
          Apply
        </Button>
      )}
      {application.error ? (
        <p role="alert" className="w-full text-pretty text-sm text-destructive">
          {application.error}
        </p>
      ) : null}
    </>
  )
}
