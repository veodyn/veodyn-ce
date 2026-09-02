'use client'

import { useState, useCallback, type ComponentProps } from 'react'
import { useQueryById, useUpdateQuery } from '@/hooks/use-queries'
import { useExecuteQuery, useQueryResult, useFormatQuery } from '@/hooks/use-query-execution'
import { useDataSources, useDataSourceSchema } from '@/hooks/use-data-sources'
import { useAiEnabled } from '@/hooks/use-ai'
import { UnsavedChangesGuard } from '@/components/shared/unsaved-changes-guard'
import type { AdhocViz } from '@/lib/viz-choices'
import { QueryEditorHeader } from './query-editor-header'
import { QueryEditorSidebar } from './query-editor-sidebar'
import { EditorControls } from './editor-controls'
import { QueryEditorResults } from './query-editor-results'
import { QueryEditorSplitPane } from './query-editor-split-pane'
import { QueryAuthoringModeTabs, QueryAiPromptBar } from './query-ai-authoring'
import { QueryVisualPane } from './query-visual-pane'
import { QueryEditorDialogs, type QueryEditorDialog } from './query-editor-dialogs'
import { useQueryBuffer } from './use-query-buffer'
import { useVisualMode } from './use-visual-mode'
import { useEditorParameters } from './use-editor-parameters'
import { useSaveSql } from './use-save-sql'
import { QueryEditorParameterStrip } from './query-editor-parameter-strip'

const EDITOR_CONTAINER_ID = 'query-editor-container'

interface QueryEditorPageProps {
  queryId?: number
}

export function QueryEditorPage({ queryId }: QueryEditorPageProps) {
  const { data: existingQuery } = useQueryById(queryId)
  const { data: dataSources } = useDataSources()
  const updateQuery = useUpdateQuery()
  const executeQuery = useExecuteQuery()
  const formatQuery = useFormatQuery()

  const { queryText, setQuery, appendQuery, dataSourceId, setDataSourceId, isDirty, setIsDirty } =
    useQueryBuffer(existingQuery, dataSources)

  const [autoLimit, setAutoLimit] = useState(true)

  // Auto LIMIT is a SQL-only convenience: appending "LIMIT 1000" to a
  // JSON-syntax connector's query (MetroCloudAlliance, GBFS, weather, ...)
  // does not limit anything, it just becomes a second line the JSON parser
  // rejects as "Extra data". Gate on the resolved data source's syntax
  // rather than guessing from the query text.
  const isSqlDataSource = dataSources?.find((source) => source.id === dataSourceId)?.syntax === 'sql'

  // Parameters are authored by writing `{{ name }}` in the buffer, so the list
  // is derived from the SQL rather than edited directly. Values live here too:
  // the ad hoc endpoint refuses a run with a parameter missing, so a buffer
  // containing `{{ x }}` cannot execute at all until something supplies x.
  const params = useEditorParameters(queryText, existingQuery, setIsDirty)

  // At most one source-menu dialog is open at a time.
  const [dialog, setDialog] = useState<QueryEditorDialog | null>(null)

  // AI authoring. Off by default and only ever on when config.ai.enabled is
  // true, so with AI off the page renders exactly the manual PRO editor.
  const aiEnabled = useAiEnabled()

  // `undefined` rather than 0 so the hook skips the fetch instead of asking the
  // backend for the schema of a data source that cannot exist.
  const { data: schema } = useDataSourceSchema(dataSourceId || undefined)
  const { data: existingResult } = useQueryResult(existingQuery?.latest_query_data_id)

  // Executes an explicit SQL string so the Visual builder's own Run button can
  // execute what it just compiled without waiting for a state round trip.
  // The visualization the result on screen was run for, or null when it was not
  // run for one. Set here rather than in the builder because this is the one
  // place that knows which run produced the result the pane is showing: PRO's
  // Execute clears it, so a chart picked in Visual does not follow the analyst
  // back.
  const [runViz, setRunViz] = useState<AdhocViz | null>(null)

  const runSql = useCallback(
    (sql: string, viz: AdhocViz | null = null) => {
      let finalQuery = sql
      if (autoLimit && isSqlDataSource && !sql.toLowerCase().includes('limit')) {
        finalQuery += '\nLIMIT 1000'
      }
      setRunViz(viz)
      executeQuery.mutate({
        queryId,
        queryText: finalQuery,
        dataSourceId,
        parameters: params.executionValues(),
      })
    },
    [queryId, dataSourceId, autoLimit, isSqlDataSource, executeQuery, params]
  )

  const handleExecute = useCallback(() => runSql(queryText), [runSql, queryText])

  const { saveSql, isSaving } = useSaveSql({
    queryId,
    existingQuery,
    dataSourceId,
    parameters: params.parameters,
    setIsDirty,
  })

  // Both authoring surfaces hand SQL back to the shared editor buffer. A
  // generated draft is never executed for the analyst: it lands in the editor
  // to be read, and Execute stays the analyst's own click.
  const visual = useVisualMode({
    aiEnabled,
    queryText,
    applyAuthoredSql: setQuery,
    runSql,
    saveSql,
  })

  // Zero-arg on purpose: this one is wired straight to a Button, whose onClick
  // would otherwise hand the click event in as the SQL to save.
  const handleSave = useCallback(() => saveSql(queryText), [saveSql, queryText])

  const handleFormat = useCallback(async () => {
    const formatted = await formatQuery.mutateAsync(queryText)
    setQuery(formatted)
  }, [queryText, formatQuery, setQuery])

  const currentResult = executeQuery.data ?? existingResult ?? null

  const resultsProps: ComponentProps<typeof QueryEditorResults> = {
    isExecuting: executeQuery.isPending,
    error: executeQuery.error,
    result: currentResult,
    visualizations: existingQuery?.visualizations,
    // Only while the ad hoc result is the one on screen. Fall back to the
    // stored result and the saved visualizations own it again.
    adhocViz: executeQuery.data ? runViz : null,
    queryId,
    canEdit: !existingQuery || Boolean(existingQuery.can_edit),
    // An unsaved query defaults to unsafe: publishing needs a saved
    // visualization anyway, and the dialog explains itself when refused.
    isQuerySafe: existingQuery?.is_safe ?? false,
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Covers the sidebar too, not just the address bar. See the component. */}
      <UnsavedChangesGuard
        isDirty={isDirty}
        title="Leave this query without saving?"
        description="The SQL in the editor has not been saved. Leaving now discards it."
        confirmLabel="Discard SQL"
      />
      <QueryEditorHeader
        existingQuery={existingQuery}
        isDirty={isDirty}
        queryId={queryId}
        onOpenSchedule={() => setDialog('schedule')}
        onOpenApiKey={() => setDialog('apiKey')}
        onOpenAddToDashboard={() => setDialog('addToDashboard')}
        onOpenPermissions={() => setDialog('permissions')}
      />

      {/* The mode toggle gets a full-width row of its own, directly under the
          title. It used to live inside the editor column, which put it to the
          right of the PRO schema rail and full-width in Visual mode, so the
          control moved sideways under the pointer that had just clicked it.
          Above the columns, only what it switches changes. Never mounted when
          config.ai.enabled is false: PRO is then the only mode there is. */}
      {aiEnabled && (
        <QueryAuthoringModeTabs
          mode={visual.mode}
          onModeChange={visual.setMode}
          onRequestPro={visual.openProTab}
        />
      )}

      {/* Editor Area */}
      <div className="flex flex-1 min-h-0">
        {/* Schema Browser. PRO only: the tree is there to be read while writing
            SQL by hand, and its one action appends the name it was clicked on to
            the editor buffer. In Visual mode that buffer is off screen, so a
            click here edited a query nobody could see. The data source picker it
            carries moves into the Visual pane, next to the dataset picker. */}
        {!visual.active && (
          <QueryEditorSidebar
            dataSources={dataSources ?? []}
            dataSourceId={dataSourceId}
            onDataSourceIdChange={setDataSourceId}
            schema={schema ?? []}
            onInsert={appendQuery}
          />
        )}

        {/* Editor + Results */}
        <div id={EDITOR_CONTAINER_ID} className="flex-1 flex flex-col min-w-0">
          {/* The prompt bar belongs to PRO, so it lives in the column the toggle
              switches rather than in the toggle's own row. */}
          {aiEnabled && visual.mode === 'pro' && (
            <QueryAiPromptBar
              schema={schema ?? []}
              currentSql={queryText}
              onGenerated={setQuery}
              dataSource={dataSources?.find((source) => source.id === dataSourceId) ?? null}
            />
          )}
          {/* Controls belong to PRO: Run/Save/Format act on the Monaco buffer,
              which is not what Visual mode displays. In Visual mode the builder
              owns all three of those, so these are unmounted to keep a hidden
              buffer unreachable. */}
          {!visual.active && (
            <EditorControls
              onExecute={handleExecute}
              onSave={handleSave}
              onFormat={handleFormat}
              isExecuting={executeQuery.isPending}
              isSaving={isSaving}
              isDirty={isDirty}
              autoLimit={autoLimit}
              onAutoLimitChange={setAutoLimit}
              showAutoLimit={isSqlDataSource}
            />
          )}

          {/* PRO only, like the controls above it: the parameters come from the
              SQL buffer, which Visual mode does not show. */}
          {!visual.active && <QueryEditorParameterStrip params={params} />}

          {visual.active ? (
            <>
              <QueryVisualPane
                datasetId={visual.datasetId}
                onDatasetIdChange={visual.changeDataset}
                dataSources={dataSources ?? []}
                dataSourceId={dataSourceId}
                onDataSourceIdChange={setDataSourceId}
                onCompile={visual.run}
                onSwitchToPro={visual.switchToPro}
                onSave={visual.save}
                isSaving={isSaving}
                draft={visual.draft}
                onDraftChange={visual.setDraft}
                onCompiledSqlChange={visual.setCompiledSql}
              />
              {/* Visual mode has no editor pane to split against, so its results
                  sit below it as a plain flex row rather than a resizable
                  panel: there is nothing on the other side of a splitter here. */}
              <QueryEditorResults {...resultsProps} />
            </>
          ) : (
            <QueryEditorSplitPane
              editor={{
                value: queryText,
                onChange: setQuery,
                onExecute: handleExecute,
                onSave: handleSave,
                schema: schema ?? [],
              }}
              results={resultsProps}
            />
          )}
        </div>
      </div>

      {/* Dialogs */}
      {existingQuery && (
        <QueryEditorDialogs
          query={existingQuery}
          open={dialog}
          onClose={() => setDialog(null)}
          onSaveSchedule={(schedule) => updateQuery.mutate({ id: existingQuery.id, schedule })}
        />
      )}
    </div>
  )
}
