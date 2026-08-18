'use client'

// Creating one query the AI wrote, in the order that leaves it usable. Shared
// by the dashboard, KPI and report-section cards.
import { useCreateQuery } from '@/hooks/use-queries'
import { useArchiveQuery } from '@/hooks/use-query-mutations'
import { useCreateVisualization } from '@/hooks/use-visualizations'
import { USE_REAL_API } from '@/services/redash/config'
import { executeSavedQuery } from '@/services/redash/execution'
import { AppError, ErrorIds } from '@/lib/errorIds'
import { inferredVizOptions } from '@/lib/visualizations'
import { DEFAULT_VIZ_ID, resolveVizChoice } from '@/lib/viz-choices'
import type { NewQueryProposal } from '@/types/ai-create'
import type { RedashQueryResult } from '@/services/redash/types'

/** A query that now exists, and what to show for it. */
export interface WrittenQuery {
  queryId: number
  /** The query's own name as stored, which de-collision may have changed. */
  queryName: string
  /**
   * What to point a dashboard widget at. Null when the query saved but has
   * nothing to show: an invented id would put somebody else's visualization on
   * the dashboard.
   */
  visualizationId: number | null
  /**
   * The visualization as configured, for a caller that wants to render it
   * without reading it back: a query written a moment ago is not in the list
   * the card already holds.
   */
  visualization: {
    queryName: string
    type: string
    name: string
    options: Record<string, unknown>
  }
}

export function useWriteProposedQuery() {
  const createQuery = useCreateQuery()
  const createVisualization = useCreateVisualization()
  const archiveQuery = useArchiveQuery()

  /**
   * Put back the query this write created, when the write is about to fail.
   *
   * Archive rather than delete because that is all Redash offers (its DELETE
   * archives). A failed archive is swallowed so it cannot replace the caller's
   * real error with a worse one.
   */
  async function discard(queryId: number): Promise<void> {
    try {
      await archiveQuery.mutateAsync(queryId)
    } catch {
      // The orphan survives; the caller's own error is the more useful of the two.
    }
  }

  /**
   * Write the query, run it, then build its visualization. That order matters: a
   * widget or a KPI reads the query's last stored result, and one written a
   * second ago has none, so without the run every new panel says "No data".
   * Running first also puts the result in hand when the options are chosen. A
   * failed run is not reported: the query exists, and Refresh is right there.
   */
  async function write(
    proposal: NewQueryProposal,
    dataSourceId: number,
    options?: {
      // What to call the visualization when the shape is the table every query
      // already has. A KPI has no second name to offer, so the query's own is
      // used for it.
      tableLabel?: string
      // A column the caller will read out of the result, which makes a failed
      // run fatal instead of cosmetic. Set by the KPI path only.
      requireColumn?: string
    }
  ): Promise<WrittenQuery> {
    const query = await createQuery.mutateAsync({
      name: proposal.name,
      description: proposal.description,
      // Byte-identical to what the validator passed, the same rule the query
      // card follows: nothing on the way here may edit it.
      query: proposal.sql,
      data_source_id: dataSourceId,
    })
    // The caller says whether a failed run is fatal, because the two want
    // opposite things: a dashboard panel that cannot run still offers Refresh, a
    // KPI that cannot run is a number that does not exist.
    let result: RedashQueryResult | undefined
    if (USE_REAL_API) {
      try {
        result = await executeSavedQuery(query.id, { maxAge: 0 })
      } catch (cause) {
        if (options?.requireColumn != null) {
          await discard(query.id)
          throw new AppError(
            ErrorIds.AI_WRITTEN_QUERY_UNRUNNABLE,
            'the query would not run, so nothing was created',
            { queryId: query.id, cause }
          )
        }
        result = undefined
      }
      if (options?.requireColumn != null) {
        // Two model calls, two names: the conversation named this column and a
        // separate generation wrote the SQL and chose its own aliases. Nothing
        // upstream makes them agree.
        const columns = result?.data.columns ?? []
        if (!columns.some((column) => column.name === options.requireColumn)) {
          await discard(query.id)
          throw new AppError(
            ErrorIds.AI_WRITTEN_QUERY_COLUMN_MISSING,
            `the query ran but has no column "${options.requireColumn}" (it returns ${
              columns.map((column) => column.name).join(', ') || 'no columns'
            }), so nothing was created`,
            { queryId: query.id }
          )
        }
      }
    }

    // A chart shape is an option on a CHART visualization, so the choice becomes
    // {type, name, options}. Every new query already has a TABLE visualization,
    // which is what a table-shaped caller points at.
    const choice = resolveVizChoice(proposal.vizChoiceId)
    // Authored options go UNDER the inference, not over it: every inferOptions
    // refuses to overwrite a mapping it is handed, and the service saw the
    // statement's real columns while the guess did not.
    const authored = { ...choice.options, ...proposal.vizOptions }
    // The plugin's own inference, the same call the edit dialog makes when a type
    // is picked: a choice carries only what makes it that shape
    // (`{globalSeriesType: 'bar'}`) and no column mapping at all. One value, read
    // twice, so what is saved and what is reported back are the same options.
    const vizOptions = result ? inferredVizOptions(choice.type, authored, result.data) : authored
    const isTable = choice.id === DEFAULT_VIZ_ID
    let visualizationId = query.visualizations?.[0]?.id ?? null
    if (!isTable) {
      const created = await createVisualization.mutateAsync({
        queryId: query.id,
        type: choice.type,
        name: choice.label,
        options: vizOptions,
      })
      visualizationId = created.id
    }

    return {
      queryId: query.id,
      queryName: query.name,
      visualizationId,
      visualization: {
        queryName: query.name,
        type: isTable ? 'TABLE' : choice.type,
        name: isTable ? (options?.tableLabel ?? query.name) : choice.label,
        options: isTable ? {} : vizOptions,
      },
    }
  }

  return { write, isPending: createQuery.isPending || createVisualization.isPending }
}
