'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import { Pencil, Play, RefreshCw } from 'lucide-react'
import { useQueryById } from '@/hooks/use-queries'
import { useTagVocabulary } from '@/hooks/use-tag-vocabulary'
import { useOptimisticTags } from '@/hooks/use-optimistic-tags'
import { useQueryResult, useExecuteQuery } from '@/hooks/use-query-execution'
import { EditInPlace } from '@/components/shared/edit-in-place'
import { Button } from '@/components/ui/button'
import { TagsControl } from '@/components/shared/tags-control'
import { FavoritesControl } from '@/components/shared/favorites-control'
import { useToast } from '@/components/shared/toast-provider'
import { TimeAgo } from '@/components/shared/time-ago'
import { VisualizationTabs } from '@/components/query/visualization-tabs'
import { ParametersBar } from '@/components/parameters/parameters-bar'
import { QuerySourceMenu } from '@/components/query/query-source-menu'
import { ScheduleDialog } from '@/components/query/schedule-dialog'
import { EmbedDialog } from '@/components/query/embed-dialog'
import { ApiKeyDialog } from '@/components/query/api-key-dialog'
import { AddToDashboardDialog } from '@/components/query/add-to-dashboard-dialog'
import { PermissionsEditorDialog } from '@/components/query/permissions-editor-dialog'
import { QueryDraftBadge } from '@/components/query/query-draft-badge'
import { useConfig } from '@/components/config/config-provider'
import { useUpdateQuery } from '@/hooks/use-queries'
import { useAuthStore } from '@/stores/auth-store'
import { formatQuerySchedule } from '@/lib/format-schedule'
import { PageContainer } from '@/components/layout/page-container'
import { PageLoading } from '@/components/layout/page-loading'
import { NoData } from '@/components/ui/no-data'
import { ScheduleIndicator } from '@/components/query/schedule-indicator'
import { resolveParameterValues } from '@/lib/parameters/dynamic-dates'

export default function QueryViewPage({ params }: { params: Promise<{ queryId: string }> }) {
  const { queryId } = use(params)
  const id = parseInt(queryId, 10)
  const { data: query, isLoading } = useQueryById(id)
  const { data: queryResult } = useQueryResult(query?.latest_query_data_id)
  const executeQuery = useExecuteQuery()
  const toast = useToast()
  const updateQuery = useUpdateQuery()
  const currentUser = useAuthStore((s) => s.currentUser)
  // Always an array and never rejecting, so the vocabulary being down degrades
  // the add input to free text rather than taking tagging out.
  const tagSuggestions = useTagVocabulary().data
  // The array arrives whole from TagsControl, `domain:*` included, so a save
  // built from it cannot drop a domain hub.
  const saveTags = useOptimisticTags(['query', id], (tags, options) =>
    updateQuery.mutate({ id, tags }, options)
  )
  // Read up here with the other hooks, not down beside the badge: the loading
  // and not-found returns below are early, so a hook after them runs on some
  // renders and not others.
  const draftsEnabled = useConfig().features.query_drafts

  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [embedOpen, setEmbedOpen] = useState(false)
  const [apiKeyOpen, setApiKeyOpen] = useState(false)
  const [addToDashOpen, setAddToDashOpen] = useState(false)
  const [permissionsOpen, setPermissionsOpen] = useState(false)
  // The applied parameter values, owned here rather than inside ParametersBar
  // because two controls start a run and both have to send the same values.
  // null means "nothing applied yet", which is not the same as an empty object:
  // it is what makes the query's own saved defaults the first thing we send.
  // Seeded lazily for the same reason the guards below are early returns: the
  // query is not loaded on the first render, so there is nothing to seed from.
  const [appliedParams, setAppliedParams] = useState<Record<string, unknown> | null>(null)
  // Edits typed into the bar but not yet applied. Nonzero means every other way
  // of starting a run would use stale values, so they are shut off until Apply.
  const [pendingParamCount, setPendingParamCount] = useState(0)

  // The same skeleton loading.tsx puts up for this route, so the segment
  // arriving and the query arriving are one continuous wait rather than a
  // skeleton that blinks out into a line of grey text.
  if (isLoading) {
    return <PageLoading label="Loading query" />
  }

  if (!query) {
    return (
      <PageContainer>
        <NoData message="Query not found" />
      </PageContainer>
    )
  }

  // Same rule the overflow menu applies to its own Schedule item, so the two
  // ways into the dialog appear and disappear together. Tagging is gated on it
  // too, so the chips are editable exactly when Redash would accept the write.
  const canEdit = Boolean(query.can_edit || currentUser?.isAdmin)
  const scheduleSummary = formatQuerySchedule(query.schedule)

  // A parameter's saved `value` is its default, so an unparameterised run still
  // has to send something: until somebody applies a change, that default is the
  // value the query was written to run with.
  const effectiveParams =
    appliedParams ?? Object.fromEntries(query.options.parameters.map((p) => [p.name, p.value]))

  // One owner for the run, because there are now two controls that start it:
  // the header button, and the one in the empty results panel for a query that
  // has never been run. They have to report the same way, and a refresh that
  // silently succeeded once already read as an inert button.
  //
  // Takes the values rather than reading `effectiveParams` itself, because Apply
  // has to run with what it just committed: setState is not visible to the call
  // that scheduled it, so a run reading state here would use the previous values.
  const executeWith = (parameters: Record<string, unknown>) => {
    executeQuery.mutate(
      {
        queryId: id,
        queryText: query.query,
        dataSourceId: query.data_source_id,
        // This page always shows the saved text, so the stored query and the
        // buffer cannot differ here. Running the saved one is what gets the
        // parameter schema applied server-side, which multi-value parameters
        // need. The editor keeps the ad hoc path.
        savedQuery: true,
        // Resolved here, at the moment of the run, rather than when a preset was
        // picked. That is what makes "Last 7 days" mean the seven days before
        // this execution; resolving on selection would freeze the window and go
        // quietly stale on every later run.
        parameters: resolveParameterValues(query.options.parameters, parameters, new Date()),
      },
      {
        // A refresh that finishes in milliseconds shows no spinner at all, so
        // without this the button looks inert every time.
        onSuccess: () => toast.success('Query refreshed.'),
        onError: (error) =>
          toast.error(error instanceof Error ? error.message : 'Query refresh failed.'),
      }
    )
  }

  const runQuery = () => executeWith(effectiveParams)

  // When the rows on screen were read. A run in this session is newer than the
  // stored result the query carries, so it wins; falling back to the query's own
  // field is what makes this agree with /schedules on an untouched page.
  const resultAt =
    executeQuery.data?.retrieved_at ?? queryResult?.retrieved_at ?? query.retrieved_at ?? null

  return (
    <PageContainer>
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          {/* The editable title is this page's heading. EditInPlace renders a
              span, so the h1 has to come from here or the page ships with no
              heading at all. */}
          {/* This is the page a reader lands on, so it is the page that needs
              the star. The editor header carries one too, for the author. */}
          <div className="flex items-center gap-2">
            <h1 className="m-0">
              <EditInPlace
                value={query.name}
                onSave={(name) => updateQuery.mutate({ id, name })}
                className="font-display text-2xl font-medium"
              />
            </h1>
            {/* The reader's landing page, so it is the one that has to say the
                query is not in anyone else's list yet. Only where the draft
                workflow exists: with the flag off, saving shares the query and
                nothing can leave one in this state. */}
            {draftsEnabled && query.is_draft && <QueryDraftBadge />}
            <FavoritesControl type="queries" id={id} isFavorite={query.is_favorite ?? false} />
          </div>
          <div className="flex items-center gap-3 mt-2">
            <TagsControl
              tags={query.tags}
              editable={canEdit}
              onChange={saveTags}
              suggestions={tagSuggestions}
            />
            {/* Two ages, each said out loud. A bare "Updated 10 hours ago" on a
                page whose body is a results table reads as the age of those
                rows, and it is not: it tracks the query object. Setting a
                refresh schedule, which changes no data at all, flipped it to
                "just now" while every result value stayed byte-identical.
                "Last result" is the wording /schedules already uses for the
                same field, so the two screens now agree instead of quietly
                reporting different numbers for the same query. */}
            {resultAt !== null && (
              <span className="text-sm text-muted-foreground">
                Last result <TimeAgo date={resultAt} />
              </span>
            )}
            <span className="text-sm text-muted-foreground">
              Query edited <TimeAgo date={query.updated_at} />
            </span>
            {query.runtime > 0 && (
              <span className="text-sm text-muted-foreground">
                Runtime: {query.runtime.toFixed(2)}s
              </span>
            )}
            {scheduleSummary && (
              <ScheduleIndicator
                summary={scheduleSummary}
                onOpen={canEdit ? () => setScheduleOpen(true) : null}
              />
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Redash disables Execute the same way while a parameter is dirty
              (QueryView.jsx:114). A run started now would use the values the
              viewer can see they replaced, and say nothing about it. */}
          <Button
            onClick={runQuery}
            disabled={executeQuery.isPending || pendingParamCount > 0}
          >
            {executeQuery.isPending ? (
              <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Play className="h-4 w-4" aria-hidden="true" />
            )}
            {executeQuery.isPending ? 'Refreshing…' : 'Refresh'}
          </Button>
          <Button variant="outline" render={<Link href={`/queries/${id}/source`} />}>
            <Pencil className="h-4 w-4" />
            Edit Source
          </Button>
          <QuerySourceMenu
            query={query}
            onOpenSchedule={() => setScheduleOpen(true)}
            onOpenApiKey={() => setApiKeyOpen(true)}
            onOpenEmbed={() => setEmbedOpen(true)}
            onOpenAddToDashboard={() => setAddToDashOpen(true)}
            onOpenPermissions={() => setPermissionsOpen(true)}
          />
        </div>
      </div>

      {query.options.parameters.length > 0 && (
        <ParametersBar
          parameters={query.options.parameters}
          // ParametersBar fires this on Apply, not per keystroke, so this is the
          // commit: remember the values so the next Refresh runs them too, and
          // run once now with what was just committed.
          onChange={(values) => {
            setAppliedParams(values)
            executeWith(values)
          }}
          onDirtyChange={setPendingParamCount}
        />
      )}

      <VisualizationTabs
        visualizations={query.visualizations}
        queryResult={executeQuery.data ?? queryResult ?? null}
        queryId={id}
        onRun={runQuery}
        isRunning={executeQuery.isPending}
        runDisabled={pendingParamCount > 0}
        fill
      />

      <ScheduleDialog
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        schedule={query.schedule as { interval: number | null; time: string | null; day_of_week: string | null; until: string | null } | null}
        onSave={(schedule) => updateQuery.mutate({ id, schedule })}
      />
      <EmbedDialog
        open={embedOpen}
        onClose={() => setEmbedOpen(false)}
        visualizationId={query.visualizations[0]?.id ?? 0}
        isSafe={query.is_safe}
        shareToken={query.visualizations[0]?.api_key ?? null}
      />
      <ApiKeyDialog
        open={apiKeyOpen}
        onClose={() => setApiKeyOpen(false)}
        queryId={id}
        apiKey={query.api_key}
      />
      <AddToDashboardDialog
        open={addToDashOpen}
        onClose={() => setAddToDashOpen(false)}
        queryId={id}
        visualizations={query.visualizations}
      />
      <PermissionsEditorDialog
        open={permissionsOpen}
        onClose={() => setPermissionsOpen(false)}
        objectId={id}
        authorId={query.user.id}
      />
    </PageContainer>
  )
}
