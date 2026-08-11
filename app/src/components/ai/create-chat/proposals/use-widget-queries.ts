'use client'

// Turning a proposed widget into something a dashboard can hold.
//
// A widget names a query that exists, or carries one the service just wrote. A
// dashboard cannot hold the second kind: a widget points at a VISUALIZATION,
// which only exists once the query does. So the new ones are created first, and
// both cards (create and edit) go through this so neither grows its own copy of
// the write.
//
// The write itself is use-write-proposed-query.ts, shared with the KPI and report
// cards. What stays here is the per-widget bookkeeping: which widget failed, and
// the second real id a dashboard widget needs that a KPI does not.
//
// Ordering matters and is the reason this returns before either card touches
// the dashboard: a query that fails to save must not leave a dashboard with a
// hole where its widget was meant to be.
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
   * What the widget should show, for a query created here.
   *
   * An existing query is looked up in the list the card already holds; one
   * written a moment ago is not in that list yet, and refetching it to read
   * back what we just sent would be a round trip for facts we have.
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
   * Sequential rather than parallel, like the widget writes the cards already
   * do: several statements arriving at the warehouse at once is a burst nobody
   * asked for, and one failing must not take the rest with it.
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
        // The widget's own heading names a table-shaped panel: it is what the
        // analyst wrote in the proposal, and the only one of the two names they
        // chose themselves.
        const written = await writeQuery.write(widget.newQuery, dataSourceId, {
          tableLabel: widget.title,
        })
        if (written.visualizationId == null) {
          // The query saved but has nothing to show on a dashboard. Reported
          // rather than guessed at: an invented id would put someone else's
          // visualization on the dashboard.
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
