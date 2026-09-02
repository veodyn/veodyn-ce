'use client'

// One visualization tab's body, split out of visualization-tabs.tsx so the
// data question is asked once, in a place that can hold the answer.
//
// The tabs used to gate every panel on `!resultData` and show one shared "Run
// the query" state. A type that draws from something other than this query's
// rows (an external feed, another query, nothing at all) would have sat behind
// that state forever, because the query it hangs off may never be run.
import { Play, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { VisualizationErrorBoundary } from '@/components/visualizations/visualization-error-boundary'
import { VisualizationRenderer } from '@/components/visualizations/visualization-renderer'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import { visualizationData } from '@/lib/visualizations'
import type { RedashTableOptions } from '@/services/redash/types'
import { QueryResultTable } from './query-result-table'

export interface VisualizationTabPanelProps {
  viz: MockVisualization
  resultData: QueryResultData | null
  isRunning: boolean
  /**
   * Runs the query behind these tabs, from the empty state. Optional because
   * the editor never shows that state: it mounts the tabs only once a run has
   * produced a result, so it has nothing to offer a Run button for.
   */
  onRun?: () => void
  /** Refuses the run without hiding the control. See VisualizationTabs. */
  runDisabled?: boolean
  /** The saved query behind these rows, for the backend's own xlsx export. */
  queryId?: number
}

export function VisualizationTabPanel({
  viz,
  resultData,
  isRunning,
  onRun,
  runDisabled = false,
  queryId,
}: VisualizationTabPanelProps) {
  const data = visualizationData(viz.type, resultData)

  if (!data) {
    // The line on its own was an instruction with nothing to act on. The only
    // Run control is in the page header, which is off screen as soon as the
    // query is long enough to scroll, so the reader is told what to do in the
    // one place that cannot do it.
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-sm text-muted-foreground">
        <p className="m-0">{isRunning ? 'Running the query…' : 'Run the query to see results'}</p>
        {onRun && (
          <Button onClick={onRun} disabled={isRunning || runDisabled}>
            {isRunning ? (
              <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Play className="h-4 w-4" aria-hidden="true" />
            )}
            Run query
          </Button>
        )}
      </div>
    )
  }

  if (viz.type === 'TABLE') {
    const { columns } = (viz.options ?? {}) as RedashTableOptions
    return <QueryResultTable data={data} columns={columns} queryId={queryId} />
  }

  // Dashboards, wall slides and report blocks all wrap the renderer; this
  // surface was the one that did not, and it is the one where a renderer is
  // most likely to meet columns it was not configured for, since the Visual
  // builder can point any type at whatever SQL it just composed. A throw here
  // took the whole editor with it, losing the query the analyst was writing.
  return (
    <VisualizationErrorBoundary>
      <VisualizationRenderer visualization={viz} data={data} />
    </VisualizationErrorBoundary>
  )
}
