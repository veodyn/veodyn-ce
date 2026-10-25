'use client'

import { Square } from 'lucide-react'
import { useState } from 'react'
import { IconButton } from '@/components/shared/icon-button'
import { ListLoadError } from '@/components/shared/list-load-error'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { SkeletonCard } from '@/components/ui/skeleton-card'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller'
import { useChatThread } from '@/hooks/use-chat-thread'
import { useThreadSubjectLabel } from '@/hooks/use-thread-subject-label'
import { ChatComposer } from './chat-composer'
import { ChatTranscript, type Selection } from './chat-transcript'
import { ContributedDraft } from './contributed-draft'
import { DashboardDraftActions } from './dashboard-draft-actions'
import { DashboardEditActions } from './dashboard-edit-actions'
import { DashboardEditCard } from './dashboard-edit-card'
import { DashboardDraftCard } from './dashboard-draft-card'
import { DetailPane } from './detail-pane'
import { DraftActions } from './draft-actions'
import { DraftCard } from './draft-card'
import { FollowNewTurns } from './follow-new-turns'
import { OperationActions } from './operation-actions'
import { OperationCard } from './operation-card'
import { QueryEditActions } from './query-edit-actions'
import { QueryEditCard } from './query-edit-card'
import { SavedVizPane } from './saved-viz-pane'
import { VizDraftActions } from './viz-draft-actions'
import { VizDraftCard } from './viz-draft-card'

export function ChatThreadView({ threadId }: { threadId: string }) {
  const chat = useChatThread(threadId)
  const subjectLabel = useThreadSubjectLabel(threadId)
  const [selection, setSelection] = useState<Selection | null>(null)
  const { state, results } = chat
  const querySync = { held: state.queryDraftSync, hold: chat.holdQueryDraftSync, retry: chat.retryQueryDraftSync }

  const resultForSql = (sql: string) => {
    const run = Object.values(state.runs).find((one) => one.sql === sql && results[one.callId])
    return run ? results[run.callId] : undefined
  }

  const renderDraft = (draftId: string, version: number) => {
    const dashboardDraft = state.dashboardDrafts[draftId]
    if (dashboardDraft) {
      return (
        <DashboardDraftCard
          draft={dashboardDraft}
          version={version}
          queryDrafts={state.drafts}
          resultForSql={resultForSql}
        >
          <DashboardDraftActions
            draft={dashboardDraft}
            queryDrafts={state.drafts}
            activeDashboard={state.activeDashboard}
            onQueryPromoted={chat.promoted}
            onDashboardPromoted={chat.promotedDashboard}
            onDashboardActive={chat.dashboardActive}
            querySync={querySync}
          />
        </DashboardDraftCard>
      )
    }
    const dashboardEdit = state.dashboardEditDrafts[draftId]
    if (dashboardEdit) {
      return (
        <DashboardEditCard draft={dashboardEdit} version={version} queryDrafts={state.drafts}>
          <DashboardEditActions
            draft={dashboardEdit}
            version={version}
            queryDrafts={state.drafts}
            onQueryPromoted={chat.promoted}
            onApplied={chat.promotedDashboardEdit}
            onDashboardActive={chat.dashboardActive}
            querySync={querySync}
          />
        </DashboardEditCard>
      )
    }
    const editDraft = state.editDrafts[draftId]
    if (editDraft) {
      return (
        <QueryEditCard draft={editDraft} version={version}>
          <QueryEditActions draft={editDraft} version={version} onApplied={chat.promotedEdit} />
        </QueryEditCard>
      )
    }
    const vizDraft = state.vizDrafts[draftId]
    if (vizDraft) {
      return (
        <VizDraftCard draft={vizDraft} version={version}>
          <VizDraftActions draft={vizDraft} version={version} onApplied={chat.promotedViz} />
        </VizDraftCard>
      )
    }
    const operation = state.operationDrafts[draftId]
    if (operation) {
      return (
        <OperationCard draft={operation} version={version}>
          <OperationActions draft={operation} version={version} onApplied={chat.promotedOperation} />
        </OperationCard>
      )
    }
    const contributed = state.contributedDrafts[draftId]
    if (contributed) {
      return (
        <ContributedDraft
          threadId={threadId}
          draft={contributed}
          version={version}
          queryDrafts={state.drafts}
          onPromoted={chat.promotedContributed}
          onQueryDraftPromoted={chat.promoted}
          querySync={querySync}
        />
      )
    }
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
        <DraftActions draft={draft} onPromoted={chat.promoted} querySync={querySync} />
      </DraftCard>
    )
  }

  if (chat.loadFailed) {
    return <ListLoadError noun="this conversation" onRetry={chat.reload} />
  }

  const pane = paneFor(selection, chat.state, results, chat.visualizations)
  const savedCall = selection?.kind === 'call' ? state.calls[selection.id] : undefined
  const closePane = () => setSelection(null)
  const sidePane = pane ? (
    <DetailPane {...pane} onClose={closePane} />
  ) : savedCall?.tool === 'show_visualization' ? (
    <SavedVizPane call={savedCall} onClose={closePane} />
  ) : null

  return (
    <ResizablePanelGroup orientation="horizontal" className="min-h-0">
      <ResizablePanel id="chat-transcript" minSize="30%" className="flex min-w-0 flex-col">
        <MessageScrollerProvider autoScroll defaultScrollPosition="end">
          <FollowNewTurns lastTurnId={state.turns.at(-1)?.id ?? null} loading={chat.loading} />
          <MessageScroller className="min-h-0 grow">
            <MessageScrollerViewport aria-label="Conversation">
              <MessageScrollerContent className="w-full max-w-3xl gap-6 px-6 py-6">
                {chat.loading ? (
                  <div role="status" aria-label="Loading the conversation">
                    <SkeletonCard />
                  </div>
                ) : null}
                <ChatTranscript
                  state={state}
                  results={results}
                  visualizations={chat.visualizations}
                  runErrors={chat.runErrors}
                  selection={selection}
                  onSelect={setSelection}
                  onRerun={chat.rerun}
                  onRetry={chat.retry}
                  renderDraft={renderDraft}
                />
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton />
          </MessageScroller>
        </MessageScrollerProvider>
        <div className="flex w-full max-w-3xl items-end gap-2 px-6 pb-6">
          <ChatComposer
            onSend={chat.send}
            disabled={chat.busy || chat.loading}
            sending={chat.busy}
            notice={chat.sendError}
            placeholder={subjectLabel}
          />
          {chat.busy && !chat.loading ? (
            <IconButton tooltip="Stop" variant="outline" size="icon" className="mb-2 rounded-full" onClick={chat.stop}>
              <Square aria-hidden="true" />
            </IconButton>
          ) : null}
        </div>
      </ResizablePanel>
      {sidePane ? (
        <>
          <ResizableHandle />
          <ResizablePanel id="chat-detail-pane" defaultSize="42%" minSize="24rem" maxSize="70%">
            {sidePane}
          </ResizablePanel>
        </>
      ) : null}
    </ResizablePanelGroup>
  )
}

function paneFor(
  selection: Selection | null,
  state: ReturnType<typeof useChatThread>['state'],
  results: ReturnType<typeof useChatThread>['results'],
  visualizations: ReturnType<typeof useChatThread>['visualizations']
) {
  if (selection?.kind === 'run') {
    const run = state.runs[selection.id]
    if (!run) return null
    return {
      title: run.purpose || 'Query',
      sql: run.sql,
      vizChoiceId: run.vizChoiceId,
      data: results[run.callId],
      visualization: visualizations[run.callId],
    }
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
