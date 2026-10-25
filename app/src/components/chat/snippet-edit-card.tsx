'use client'

import { Braces, Check, Loader2, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useState } from 'react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import type { ChatDraftCardProps } from '@/features/chat-draft-types'
import { useApplySnippetDraft } from '@/hooks/use-apply-snippet-draft'
import { lastApplied } from '@/lib/chat/promotions'
import { applySnippetEdit } from '@/lib/chat/snippet-apply'
import { parseSnippetEditDraft, type SnippetEditDraft } from '@/lib/chat/snippet-drafts'
import { ConflictPrompt } from './conflict-prompt'
import { UnsyncedNotice } from './unsynced-notice'

export const SNIPPET_EDIT_CONFLICT_MESSAGE =
  'This snippet changed after the chat read it. Overwrite those changes with this edit?'
export const SNIPPET_DELETE_CONFLICT_MESSAGE =
  'This snippet changed after the chat read it. Delete it anyway?'

const FIELD_LABELS = { trigger: 'Trigger', snippet: 'Text', description: 'Description' } as const

interface BodyProps extends Omit<ChatDraftCardProps, 'payload'> {
  edit: SnippetEditDraft
}

function Changes({ edit }: { edit: SnippetEditDraft }) {
  return (
    <>
      {(Object.keys(FIELD_LABELS) as (keyof typeof FIELD_LABELS)[]).map((field) => {
        const after = edit.changes[field]
        if (after === undefined) return null
        return (
          <div key={field} className="flex flex-col gap-0.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">{FIELD_LABELS[field]}</span>
            <span className="text-muted-foreground line-through decoration-muted-foreground/50 whitespace-pre-wrap">
              {edit.snapshot[field]}
            </span>
            <span className="whitespace-pre-wrap">{after}</span>
          </div>
        )
      })}
    </>
  )
}

function SnippetEditBody({ draftId, version, edit, promotions, onPromoted }: BodyProps) {
  const [confirming, setConfirming] = useState(false)
  const run = useCallback(
    (overwrite: boolean) => applySnippetEdit(draftId, version, edit, { overwrite }),
    [draftId, version, edit]
  )
  const application = useApplySnippetDraft(draftId, run, onPromoted)
  const applied = lastApplied(promotions)
  const applying = application.status === 'applying'
  const deleting = edit.delete === true

  return (
    <Card size="sm" className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          {deleting ? <Trash2 className="size-4" aria-hidden="true" /> : <Braces className="size-4" aria-hidden="true" />}
          <span>{deleting ? 'Delete snippet' : 'Edit snippet'}</span>
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{edit.snapshot.trigger}</code>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {deleting ? (
          <pre className="max-h-48 overflow-auto rounded-md border bg-muted/30 p-2 font-mono text-xs whitespace-pre-wrap">
            {edit.snapshot.snippet}
          </pre>
        ) : (
          <Changes edit={edit} />
        )}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        {application.status === 'conflict' ? (
          <ConflictPrompt
            message={deleting ? SNIPPET_DELETE_CONFLICT_MESSAGE : SNIPPET_EDIT_CONFLICT_MESSAGE}
            overwriteLabel={deleting ? 'Delete anyway' : 'Overwrite'}
            keepLabel={deleting ? 'Keep it' : 'Keep their changes'}
            onOverwrite={() => application.apply(true)}
            onKeep={() => {
              setConfirming(false)
              application.keep()
            }}
          />
        ) : application.status === 'unsynced' ? (
          <UnsyncedNotice onRetry={application.retrySync} />
        ) : applied !== undefined ? (
          deleting ? (
            <p className="text-sm text-muted-foreground">Deleted.</p>
          ) : (
            <Link href="/query-snippets" className={buttonVariants({ size: 'sm', variant: 'link' })}>
              Applied. Open snippets
            </Link>
          )
        ) : deleting && confirming ? (
          <div className="flex w-full flex-col gap-2 text-sm">
            <p className="text-pretty">Delete this snippet? This cannot be undone.</p>
            <div className="flex gap-2">
              <Button size="sm" variant="destructive" onClick={() => application.apply(false)} disabled={applying}>
                {applying ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                Yes, delete it
              </Button>
              <Button size="sm" variant="outline" onClick={() => setConfirming(false)} disabled={applying}>
                Keep it
              </Button>
            </div>
          </div>
        ) : deleting ? (
          <Button size="sm" variant="destructive" onClick={() => setConfirming(true)}>
            <Trash2 aria-hidden="true" />
            Delete
          </Button>
        ) : (
          <Button size="sm" onClick={() => application.apply(false)} disabled={applying}>
            {applying ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
            Apply
          </Button>
        )}
        {application.error ? (
          <p role="alert" className="w-full text-pretty text-sm text-destructive">
            {application.error}
          </p>
        ) : null}
      </CardFooter>
    </Card>
  )
}

export default function SnippetEditCard({ payload, ...rest }: ChatDraftCardProps) {
  const edit = parseSnippetEditDraft(payload)
  return edit ? <SnippetEditBody {...rest} edit={edit} /> : null
}
