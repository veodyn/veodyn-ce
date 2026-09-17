'use client'

import { Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { TextboxMarkdown } from '@/components/dashboard/textbox-markdown'
import { Button } from '@/components/ui/button'
import { MessageScrollerItem } from '@/components/ui/message-scroller'
import type { ThreadState, TurnItem, TurnView } from '@/lib/chat/thread-model'
import type { QueryResultData } from '@/lib/mock-data'
import { RunCard } from './run-card'

export const PHASE_LABELS: Record<string, string> = {
  answering: 'Thinking…',
  validating: 'Checking the SQL…',
  waiting_for_browser: 'Running the query in your browser…',
  reading_result: 'Reading the result…',
}

export type Selection = { kind: 'run'; id: string } | { kind: 'draft'; id: string }

interface ChatTranscriptProps {
  state: ThreadState
  results: Record<string, QueryResultData>
  runErrors: Record<string, string>
  selection: Selection | null
  canRerun: boolean
  onSelect: (selection: Selection) => void
  onRerun: (callId: string) => void
  onRetry: () => void
  renderDraft: (draftId: string, version: number) => ReactNode
}

function isSelected(selection: Selection | null, kind: Selection['kind'], id: string): boolean {
  return selection?.kind === kind && selection.id === id
}

export function ChatTranscript(props: ChatTranscriptProps) {
  const { state } = props
  const last = state.turns[state.turns.length - 1]
  return (
    <>
      {state.turns.map((turn) => (
        <MessageScrollerItem key={turn.id} messageId={turn.id} className="flex flex-col gap-3">
          <div className="max-w-[80%] self-end whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-sm">
            {turn.userText}
          </div>
          {turn.items.map((item, index) => (
            <TranscriptItem key={`${turn.id}-${index}`} item={item} {...props} />
          ))}
          <TurnFooter turn={turn} isLast={turn === last} onRetry={props.onRetry} />
        </MessageScrollerItem>
      ))}
    </>
  )
}

function TranscriptItem({ item, ...props }: ChatTranscriptProps & { item: TurnItem }) {
  if (item.kind === 'text') {
    return <TextboxMarkdown text={item.text} className="text-sm" />
  }
  if (item.kind === 'draft') {
    return <>{props.renderDraft(item.draftId, item.version)}</>
  }
  const run = props.state.runs[item.callId]
  if (!run) return null
  return (
    <RunCard
      run={run}
      data={props.results[item.callId]}
      error={props.runErrors[item.callId]}
      selected={isSelected(props.selection, 'run', item.callId)}
      canRerun={props.canRerun}
      onSelect={() => props.onSelect({ kind: 'run', id: item.callId })}
      onRerun={() => props.onRerun(item.callId)}
    />
  )
}

function TurnFooter({ turn, isLast, onRetry }: { turn: TurnView; isLast: boolean; onRetry: () => void }) {
  if (turn.status === 'running') {
    return (
      <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
        {PHASE_LABELS[turn.phase ?? ''] ?? 'Working…'}
      </p>
    )
  }
  if (turn.status === 'failed') {
    return (
      <div role="alert" className="flex items-center gap-3 text-sm text-destructive">
        <span>{turn.errorMessage}</span>
        {isLast ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </div>
    )
  }
  if (turn.stopReason === 'cancelled') {
    return <p className="text-xs text-muted-foreground">Stopped.</p>
  }
  return null
}
