'use client'

// Turning a proposed widget into something a dashboard can hold: a widget points
// at a VISUALIZATION, which only exists once its query does, so the new queries
// are written first. The write itself is use-write-proposed-query.ts; what stays
// here is the per-widget bookkeeping.
//
// This returns before either card touches the dashboard: a query that fails to
// save must not leave a hole where its widget was meant to be.
import type { DashboardWidgetProposal } from '@/types/ai-create'
import { useWriteProposedQuery } from './use-write-proposed-query'

/** A widget reduced to the two ids a dashboard widget is built from. */
export interface ResolvedWidget {
  title: string
  queryId: number
  visualizationId: number
  /** True when this run created the query, for the card's own reporting. */
  written: boolean
  /**
   * What the widget should show, for a query created here: one written a moment
   * ago is not yet in the list the card holds.
   */
  visualization?: {
    queryName: string
    type: string
    name: string
    options: Record<string, unknown>
  }
}

export interface WidgetQueryResult {
  resolved: ResolvedWidget[]
  /** Titles of the widgets whose query could not be written. */
  failed: string[]
}

export function useWidgetQueries() {
  const writeQuery = useWriteProposedQuery()

  /**
   * Every widget as a pair of real ids, creating the queries that do not exist.
   *
   * Sequential rather than parallel: several statements arriving at the
   * warehouse at once is a burst, and one failing must not take the rest.
   */
  async function materialize(
    widgets: DashboardWidgetProposal[],
    dataSourceId: number
  ): Promise<WidgetQueryResult> {
    const resolved: ResolvedWidget[] = []
    const failed: string[] = []

    for (const widget of widgets) {
      if (widget.queryId != null && widget.visualizationId != null) {
        resolved.push({
          title: widget.title,
          queryId: widget.queryId,
          visualizationId: widget.visualizationId,
          written: false,
        })
        continue
      }
      if (!widget.newQuery) {
        failed.push(widget.title)
        continue
      }
      try {
        // The widget's own heading names a table-shaped panel: it is the one
        // name the analyst chose themselves.
        const written = await writeQuery.write(widget.newQuery, dataSourceId, {
          tableLabel: widget.title,
        })
        if (written.visualizationId == null) {
          // The query saved but has nothing to show: an invented id would put
          // someone else's visualization on the dashboard.
          failed.push(widget.title)
          continue
        }
        resolved.push({
          title: widget.title,
          queryId: written.queryId,
          visualizationId: written.visualizationId,
          written: true,
          visualization: written.visualization,
        })
      } catch {
        failed.push(widget.title)
      }
    }

    return { resolved, failed }
  }

  return { materialize, isPending: writeQuery.isPending }
}
