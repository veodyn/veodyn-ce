'use client'

// The query editor's results pane: in-flight status, a failed run, or the
// visualizations of the run that succeeded.
import { VisualizationTabs } from './visualization-tabs'
import { QueryExecutionStatus } from './query-execution-status'
import { getVisualization } from '@/lib/visualizations'
import { readQueryError } from '@/lib/query-error'
import type { AdhocViz } from '@/lib/viz-choices'
import type { MockQueryResult, MockVisualization, QueryResultData } from '@/lib/mock-data'

// An unsaved query has no visualizations of its own, so an ad hoc run still
// gets a table to land in.
const ADHOC_TABLE: MockVisualization[] = [
  { id: 0, type: 'TABLE', name: 'Table', description: '', options: {}, created_at: '', updated_at: '' },
]

// Negative so it cannot collide with a saved visualization's id, the way 0 is
// already spoken for by the ad hoc table above. isSavedVisualization in
// viz-choices.ts is the read side of this convention: the tab strip offers no
// edit, publish or delete on a non-positive id, because there is no row behind
// it for those requests to reach.
const ADHOC_CHART_ID = -1

/**
 * What a run from the Visual builder lands in: the picked visualization plus
 * the table. The saved query's own visualizations are left out, because they
 * were configured against the columns the saved query returns.
 *
 * Options layer over the type's defaults, which is how a chart shape arrives:
 * Bar is a CHART carrying `globalSeriesType: 'bar'`. Column mapping is left
 * empty so each renderer's own positional inference stays the one owner.
 */
function adhocVisualizations(viz: AdhocViz): MockVisualization[] {
  // Picking Table means the table, not a second tab that also says Table.
  if (viz.type === 'TABLE') return ADHOC_TABLE
  const type = getVisualization(viz.type)
  return [
    {
      id: ADHOC_CHART_ID,
      type: viz.type,
      // The choice's label, so a run picked as Bar lands in a tab that says Bar
      // rather than the type's generic "Chart".
      name: viz.name || type?.displayName || viz.type,
      description: '',
      options: { ...(type?.defaultOptions ?? {}), ...viz.options },
      created_at: '',
      updated_at: '',
    },
    ...ADHOC_TABLE,
  ]
}

interface QueryEditorResultsProps {
  isExecuting: boolean
  error: unknown
  // Same union VisualizationTabs takes: a stored result, or the bare data an
  // ad hoc run comes back with.
  result: MockQueryResult | { data: QueryResultData } | null
  visualizations: MockVisualization[] | undefined
  /**
   * Set only while the result on screen came from the Visual builder's Run.
   * Null for a stored result or a PRO Execute, which is what keeps a chart the
   * builder was set to from following the analyst back to the saved query.
   */
  adhocViz?: AdhocViz | null
  queryId?: number
  /** Whether the owning query may be published. See VisualizationTabs. */
  isQuerySafe?: boolean
}

export function QueryEditorResults({
  isExecuting,
  error,
  result,
  visualizations,
  adhocViz = null,
  queryId,
  isQuerySafe = false,
}: QueryEditorResultsProps) {
  const tabs =
    adhocViz != null ? adhocVisualizations(adhocViz) : (visualizations ?? ADHOC_TABLE)
  const failure = error != null ? readQueryError(error) : null
  return (
    <div className="flex-1 overflow-auto">
      {isExecuting && <QueryExecutionStatus />}
      {failure != null && (
        <div role="alert" className="space-y-2 p-4 text-sm">
          <p className="whitespace-pre-wrap text-destructive">{failure.message}</p>
          {failure.detail != null && (
            // The code and the version are worth keeping, out of the way.
            <details className="text-muted-foreground">
              <summary className="cursor-pointer text-xs">What the data source said</summary>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words text-xs">
                {failure.detail}
              </pre>
            </details>
          )}
          {/* A failed run leaves the last good result on screen, which reads as
              the output of the query that just failed. */}
          {result != null && (
            <p className="text-xs text-muted-foreground">
              The results below are from an earlier run.
            </p>
          )}
        </div>
      )}
      {result && !isExecuting && (
        <VisualizationTabs
          visualizations={tabs}
          queryResult={result}
          queryId={queryId}
          isQuerySafe={isQuerySafe}
        />
      )}
    </div>
  )
}
