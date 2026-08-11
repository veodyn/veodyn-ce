'use client'

// Creating one query the AI wrote, in the order that leaves it usable.
//
// Extracted from use-widget-queries.ts when KPIs and report sections learned to
// carry a NewQueryProposal too. All three go through this, so none of them grows
// its own copy of the sequence, and the sequence is the part that is easy to get
// wrong: the ordering below is load-bearing in a way a reader would not guess.
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
   * nothing to show: reported rather than guessed at, because an invented id
   * would put somebody else's visualization on the dashboard.
   */
  visualizationId: number | null
  /**
   * The visualization as configured, for a caller that wants to render it
   * without reading it back. A query written a moment ago is not in the list the
   * card already holds, and refetching it to learn facts we just sent would be a
   * round trip for nothing.
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
   * A `requireColumn` failure is a refusal to create the KPI, but the query was
   * already written by then and used to stay in the library: one rejected
   * "Create KPI + query" left query 81 behind, a second attempt left 82, and
   * both were named identically to the KPI that never existed, findable only by
   * searching for them. The Archive tab already held one from an earlier
   * session, so it accumulates.
   *
   * Archive rather than delete because that is all Redash offers (its DELETE
   * archives), and it is the better semantic anyway: the SQL is one restore away
   * for anyone who wants to fix it, and it is out of the library for everyone
   * who does not.
   *
   * Failing to clean up must not replace the real error with a worse one, so a
   * failed archive is swallowed and the original refusal is what the analyst
   * sees.
   */
  async function discard(queryId: number): Promise<void> {
    try {
      await archiveQuery.mutateAsync(queryId)
    } catch {
      // The orphan survives; the caller's own error is the more useful of the two.
    }
  }

  /**
   * Write the query, run it, then build its visualization. That order matters.
   *
   * Running it BEFORE the visualization, not after: a widget or a KPI reads the
   * query's last stored result, and a query written a second ago has none.
   * Without this the dashboard the analyst just asked for arrives with every new
   * panel saying "No data", and a KPI evaluates against nothing. It is the same
   * execution the Refresh button would run, moved to where the wait already is.
   *
   * Running it first also means the result is in hand when the options are
   * chosen, which is the difference between a heatmap that names its own axes
   * and one that relies on the renderer guessing from column order.
   *
   * A failed run is not fatal and is deliberately not reported: the query
   * exists, and Refresh is right there.
   */
  async function write(
    proposal: NewQueryProposal,
    dataSourceId: number,
    options?: {
      // What to call the visualization when the shape is the table every query
      // already has. A dashboard widget passes its own heading, which is the
      // name the analyst chose and better than the query's; a KPI has no second
      // name to offer, so the query's own is right for it.
      tableLabel?: string
      // A column the caller will read out of the result, which makes a failed
      // run fatal instead of cosmetic. Set by the KPI path only: see the run
      // below for why the two callers want opposite things here.
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
    // The two callers want opposite things from a failed run, so the caller says
    // which it is rather than this deciding for both. A dashboard panel that
    // cannot run is a panel offering Refresh; a KPI that cannot run is a number
    // that does not exist, and creating one anyway means the analyst finds out at
    // the first evaluation instead of here, where they could still fix the SQL.
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
        // upstream makes them agree, and the result is in hand right here.
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
    // The service authored its options for this proposal's own shape, and no
    // card on this path lets the analyst change that shape, so they always meet
    // the type they were written for. They go UNDER the inference rather than
    // over it because every inferOptions refuses to overwrite a mapping it is
    // handed: the service saw the statement's real columns, the guess did not.
    const authored = { ...choice.options, ...proposal.vizOptions }
    // The plugin's own inference, the same call the edit dialog makes when a type
    // is picked. A choice carries only what makes it that shape
    // (`{globalSeriesType: 'bar'}`), so before this every AI-authored
    // visualization was saved with no column mapping at all, and what it drew was
    // whatever its renderer fell back to.
    //
    // One value, read twice: what is saved and what is reported back have to be
    // the same options, or the panel on the card is configured differently from
    // the one that was stored.
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
