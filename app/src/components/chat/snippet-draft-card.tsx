'use client'

import { Braces, Check, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useCallback } from 'react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import type { ChatDraftCardProps } from '@/features/chat-draft-types'
import { useApplySnippetDraft } from '@/hooks/use-apply-snippet-draft'
import { lastApplied } from '@/lib/chat/promotions'
import { applySnippetCreate } from '@/lib/chat/snippet-apply'
import { parseSnippetDraft, type SnippetDraft } from '@/lib/chat/snippet-drafts'
import { UnsyncedNotice } from './unsynced-notice'

interface BodyProps extends Omit<ChatDraftCardProps, 'payload'> {
  snippet: SnippetDraft
}

function SnippetDraftBody({ draftId, version, snippet, promotions, onPromoted }: BodyProps) {
  const run = useCallback(() => applySnippetCreate(draftId, version, snippet), [draftId, version, snippet])
  const application = useApplySnippetDraft(draftId, run, onPromoted)
  const saved = lastApplied(promotions)
  const applying = application.status === 'applying'

  return (
    <Card size="sm" className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Braces className="size-4" aria-hidden="true" />
          <span>New snippet</span>
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{snippet.trigger}</code>
        </CardTitle>
        {snippet.description ? <CardDescription>{snippet.description}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        <pre className="max-h-64 overflow-auto rounded-md border bg-muted/30 p-2 font-mono text-xs whitespace-pre-wrap">
          {snippet.snippet}
        </pre>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        {application.status === 'unsynced' ? (
          <UnsyncedNotice onRetry={application.retrySync} />
        ) : saved === undefined ? (
          <Button size="sm" onClick={() => application.apply(false)} disabled={applying}>
            {applying ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
            Save
          </Button>
        ) : (
          <Link href="/query-snippets" className={buttonVariants({ size: 'sm', variant: 'link' })}>
            Saved. Open snippets
          </Link>
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

export default function SnippetDraftCard({ payload, ...rest }: ChatDraftCardProps) {
  const snippet = parseSnippetDraft(payload)
  return snippet ? <SnippetDraftBody {...rest} snippet={snippet} /> : null
}
