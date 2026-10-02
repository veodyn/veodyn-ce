'use client'

import { Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { TextboxMarkdown } from '@/components/dashboard/textbox-markdown'
import { Button } from '@/components/ui/button'
import { MessageScrollerItem } from '@/components/ui/message-scroller'
import type { ThreadState, TurnItem, TurnView } from '@/lib/chat/thread-model'
import type { QueryResultData } from '@/lib/mock-data'
import { DashboardCard } from './dashboard-card'
import { DataSourcesCard } from './data-sources-card'
import { HelpLinkCard } from './help-link-card'
import { LibraryCard } from './library-card'
import { RunCard } from './run-card'
import { SavedVizCard } from './saved-viz-card'

export const PHASE_LABELS: Record<string, string> = {
  answering: 'Thinking…',
  validating: 'Checking the SQL…',
  waiting_for_browser: 'Running the query in your browser…',
  reading_result: 'Reading the result…',
}

export const LIBRARY_PHASE_LABELS: Record<string, string> = {
  waiting_for_browser: 'Looking in the library…',
}

export type Selection = { kind: 'run'; id: string } | { kind: 'call'; id: string } | { kind: 'draft'; id: string }

interface ChatTranscriptProps {
  state: ThreadState
  results: Record<string, QueryResultData>
  runErrors: Record<string, string>
  selection: Selection | null
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
          {grouped(turn.items).map((item, index) => (
            <TranscriptItem key={`${turn.id}-${index}`} item={item} {...props} />
          ))}
          <TurnFooter
            turn={turn}
            isLast={turn === last}
            onRetry={props.onRetry}
            library={waitsOnLibrary(state, turn)}
            linking={turn.items[turn.items.length - 1]?.kind === 'help'}
          />
        </MessageScrollerItem>
      ))}
    </>
  )
}

type RenderedItem = Exclude<TurnItem, { kind: 'help' }> | { kind: 'help'; callIds: string[] }

function grouped(items: TurnItem[]): RenderedItem[] {
  return items.reduce<RenderedItem[]>((rendered, item) => {
    const last = rendered[rendered.length - 1]
    if (item.kind !== 'help') return [...rendered, item]
    if (last?.kind === 'help') return [...rendered.slice(0, -1), { kind: 'help', callIds: [...last.callIds, item.callId] }]
    return [...rendered, { kind: 'help', callIds: [item.callId] }]
  }, [])
}

function TranscriptItem({ item, ...props }: ChatTranscriptProps & { item: RenderedItem }) {
  if (item.kind === 'help') {
    const links = item.callIds.map((callId) => props.state.helpLinks[callId]).filter((one) => one !== undefined)
    return links.length > 0 ? <HelpLinkCard links={links} /> : null
  }
  if (item.kind === 'text') {
    return <TextboxMarkdown text={item.text} className="text-sm" />
  }
  if (item.kind === 'draft') {
    return <>{props.renderDraft(item.draftId, item.version)}</>
  }
  if (item.kind === 'call') {
    const call = props.state.calls[item.callId]
    if (!call) return null
    if (call.tool === 'list_data_sources') return <DataSourcesCard call={call} />
    if (call.tool === 'describe_data_source') return null
    if (call.tool === 'search_library') return <LibraryCard call={call} />
    if (call.tool === 'open_dashboard') return <DashboardCard call={call} />
    return (
      <SavedVizCard
        call={call}
        selected={isSelected(props.selection, 'call', item.callId)}
        onSelect={() => props.onSelect({ kind: 'call', id: item.callId })}
      />
    )
  }
  const run = props.state.runs[item.callId]
  if (!run) return null
  return (
    <RunCard
      run={run}
      data={props.results[item.callId]}
      error={props.runErrors[item.callId]}
      selected={isSelected(props.selection, 'run', item.callId)}
      onSelect={() => props.onSelect({ kind: 'run', id: item.callId })}
      onRerun={() => props.onRerun(item.callId)}
    />
  )
}

function waitsOnLibrary(state: ThreadState, turn: TurnView): boolean {
  const last = turn.items[turn.items.length - 1]
  return last?.kind === 'call' && state.calls[last.callId]?.status === 'running'
}

interface TurnFooterProps {
  turn: TurnView
  isLast: boolean
  library: boolean
  linking: boolean
  onRetry: () => void
}

function TurnFooter({ turn, isLast, library, linking, onRetry }: TurnFooterProps) {
  if (turn.status === 'running') {
    const phase = linking ? 'answering' : (turn.phase ?? '')
    return (
      <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
        {(library ? LIBRARY_PHASE_LABELS[phase] : undefined) ?? PHASE_LABELS[phase] ?? 'Working…'}
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
