'use client'

import { Square } from 'lucide-react'
import { useState } from 'react'
import { defaultDataSourceId } from '@/components/ai/create-chat/proposals/proposal-model'
import { IconButton } from '@/components/shared/icon-button'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller'
import { useChatThread } from '@/hooks/use-chat-thread'
import { useDataSources } from '@/hooks/use-data-sources'
import { ChatComposer } from './chat-composer'
import { ChatTranscript, type Selection } from './chat-transcript'
import { DetailPane } from './detail-pane'
import { DraftActions } from './draft-actions'
import { DraftCard } from './draft-card'

export function ChatThreadView({ threadId }: { threadId: string }) {
  const chat = useChatThread(threadId)
  const dataSources = useDataSources()
  const dataSourceId = defaultDataSourceId(dataSources.data ?? [])
  const [selection, setSelection] = useState<Selection | null>(null)
  const { state, results } = chat

  const resultForSql = (sql: string) => {
    const run = Object.values(state.runs).find((one) => one.sql === sql && results[one.callId])
    return run ? results[run.callId] : undefined
  }

  const renderDraft = (draftId: string, version: number) => {
    const draft = state.drafts[draftId]
    if (!draft) return null
    const latest = draft.versions[draft.versions.length - 1]
    return (
      <DraftCard
        draft={draft}
        version={version}
        data={latest ? resultForSql(latest.payload.sql) : undefined}
        selected={selection?.kind === 'draft' && selection.id === draftId}
        onSelect={() => setSelection({ kind: 'draft', id: draftId })}
      >
        <DraftActions draft={draft} dataSourceId={dataSourceId} onPromoted={chat.promoted} />
      </DraftCard>
    )
  }

  if (chat.loadFailed) {
    return <p className="p-6 text-sm text-destructive">This conversation could not be opened.</p>
  }

  const pane = paneFor(selection, chat.state, results)

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <MessageScrollerProvider autoScroll defaultScrollPosition="end">
          <MessageScroller className="min-h-0 grow">
            <MessageScrollerViewport aria-label="Conversation">
              <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-6 px-6 py-6">
                {chat.loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
                <ChatTranscript
                  state={state}
                  results={results}
                  runErrors={chat.runErrors}
                  selection={selection}
                  canRerun={dataSourceId !== null}
                  onSelect={setSelection}
                  onRerun={(callId) => {
                    if (dataSourceId !== null) chat.rerun(callId, dataSourceId)
                  }}
                  onRetry={chat.retry}
                  renderDraft={renderDraft}
                />
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton />
          </MessageScroller>
        </MessageScrollerProvider>
        <div className="mx-auto flex w-full max-w-3xl items-end gap-2 px-6 pb-6">
          <ChatComposer
            onSend={chat.send}
            disabled={chat.busy || chat.loading}
            sending={chat.busy}
            notice={chat.sendError}
          />
          {chat.busy && !chat.loading ? (
            <IconButton tooltip="Stop" variant="outline" size="icon" className="mb-2 rounded-full" onClick={chat.stop}>
              <Square aria-hidden="true" />
            </IconButton>
          ) : null}
        </div>
      </div>
      {pane ? (
        <div className="w-[42%] min-w-96 shrink-0">
          <DetailPane {...pane} onClose={() => setSelection(null)} />
        </div>
      ) : null}
    </div>
  )
}

function paneFor(
  selection: Selection | null,
  state: ReturnType<typeof useChatThread>['state'],
  results: ReturnType<typeof useChatThread>['results']
) {
  if (selection?.kind === 'run') {
    const run = state.runs[selection.id]
    if (!run) return null
    return { title: run.purpose || 'Query', sql: run.sql, vizChoiceId: run.vizChoiceId, data: results[run.callId] }
  }
  if (selection?.kind === 'draft') {
    const latest = state.drafts[selection.id]?.versions.at(-1)
    if (!latest) return null
    const run = Object.values(state.runs).find((one) => one.sql === latest.payload.sql && results[one.callId])
    return {
      title: latest.payload.name,
      sql: latest.payload.sql,
      vizChoiceId: latest.payload.vizChoiceId,
      data: run ? results[run.callId] : undefined,
    }
  }
  return null
}
