'use client'

// Everything the query editor needs to hold on behalf of Visual mode, and the
// three ways out of it. Extracted from query-editor-page so the page stays a
// layout: this is the one place that decides when the builder's SQL is allowed
// to overwrite the PRO buffer.
//
// The rule, in one line: the analyst's SQL is never overwritten by navigation.
// Run and the builder's own "Open in PRO" are explicit, so they publish. The
// top PRO tab is neither, so it publishes only into a buffer that is empty or
// still holds this builder's own last output.
import { useCallback, useRef, useState } from 'react'
import type { AdhocViz } from '@/lib/viz-choices'
import type { AuthoringMode } from './query-ai-authoring'
import { type VisualDraft, emptyVisualDraft } from './visual-builder-model'

interface UseVisualModeArgs {
  /** Visual mode only exists when AI authoring is configured on. */
  aiEnabled: boolean
  /** What the PRO editor holds right now. */
  queryText: string
  /** Writes SQL into the PRO buffer and marks the query dirty. */
  applyAuthoredSql: (sql: string) => void
  /**
   * Executes a SQL string without waiting for a state round trip. The picked
   * visualization rides along so the results pane can show what the builder was
   * set to, rather than only the table.
   */
  runSql: (sql: string, viz: AdhocViz) => void
  /** Saves a SQL string, for the same no-round-trip reason as runSql. */
  saveSql: (sql: string) => void
}

export function useVisualMode({
  aiEnabled,
  queryText,
  applyAuthoredSql,
  runSql,
  saveSql,
}: UseVisualModeArgs) {
  const [mode, setMode] = useState<AuthoringMode>('pro')
  const [datasetId, setDatasetId] = useState<string | null>(null)
  // The builder's current SQL, so the top PRO tab can hand over what the analyst
  // composed rather than the PRO buffer, which is empty while in Visual mode.
  // Null means the builder has nothing valid to hand over.
  const [compiledSql, setCompiledSql] = useState<string | null>(null)
  // The field picks, held here rather than in the builder because the builder
  // unmounts every time the analyst looks at PRO. Held there, a glance at the
  // SQL cost them the spec they had assembled.
  const [draft, setDraft] = useState<VisualDraft>(emptyVisualDraft)

  // The last SQL the builder put in the buffer. Anything else in there is the
  // analyst's: typed by hand, or drafted from their own prompt.
  const publishedSql = useRef('')
  const publish = useCallback(
    (sql: string) => {
      publishedSql.current = sql
      applyAuthoredSql(sql)
    },
    [applyAuthoredSql]
  )

  // Run fills the editor and executes in one go, with the rows landing in the
  // shared results pane below the builder.
  const run = useCallback(
    (sql: string, viz: AdhocViz) => {
      publish(sql)
      runSql(sql, viz)
    },
    [publish, runSql]
  )

  // Save keeps the composed query. It publishes first, so the buffer the
  // analyst finds in PRO afterwards is the one that was saved, and so the
  // ownership check above still recognises it as this builder's own work.
  const save = useCallback(
    (sql: string) => {
      publish(sql)
      saveSql(sql)
    },
    [publish, saveSql]
  )

  // A handoff, not a commitment. The builder never parses SQL back into its
  // field picker, so PRO gets the composed SQL and the picks stay behind in the
  // draft, both intact, and the analyst can move between them at will.
  const switchToPro = useCallback(
    (sql: string) => {
      publish(sql)
      setMode('pro')
    },
    [publish]
  )

  // Navigation, and navigating must not cost the analyst their query.
  const openProTab = useCallback(() => {
    const buffer = queryText.trim()
    const ours = buffer === '' || buffer === publishedSql.current.trim()
    if (compiledSql != null && ours) publish(compiledSql)
    setMode('pro')
  }, [queryText, compiledSql, publish])

  // The picks name columns of the dataset being left, and the lifted SQL was
  // composed over it, so both go with it. Without clearing the SQL, selecting a
  // dataset that does not compile left the previous one's query standing.
  const changeDataset = useCallback((next: string) => {
    setCompiledSql(null)
    setDraft(emptyVisualDraft())
    setDatasetId(next)
  }, [])

  return {
    mode,
    setMode,
    active: aiEnabled && mode === 'visual',
    datasetId,
    changeDataset,
    draft,
    setDraft,
    setCompiledSql,
    run,
    save,
    switchToPro,
    openProTab,
  }
}
