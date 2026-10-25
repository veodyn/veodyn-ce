'use client'

// Creating one query the AI wrote, in the order that leaves it usable. Shared
// by the dashboard, KPI and report-section cards.
import { useCreateQuery } from '@/hooks/use-queries'
import { useArchiveQuery } from '@/hooks/use-query-mutations'
import { useCreateVisualization, useUpdateVisualization } from '@/hooks/use-visualizations'
import { sanitizedVizOptions } from '@/lib/chat/viz-options'
import { USE_REAL_API } from '@/services/redash/config'
import { executeSavedQuery } from '@/services/redash/execution'
import { AppError, ErrorIds } from '@/lib/errorIds'
import { inferredVizOptions } from '@veodyn/viz'
import { DEFAULT_VIZ_ID, resolveVizChoice } from '@/lib/viz-choices'
import type { NewQueryProposal } from '@/types/proposal-kit'
import type { MockQueryParameter } from '@/lib/mock-data'
import { toNativeParameters, type ChatParameterDefinition } from '@/lib/chat/query-parameters'
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

function defaultValues(parameters: ChatParameterDefinition[] | undefined): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const parameter of parameters ?? []) {
    if (parameter.value !== undefined && parameter.value !== null && parameter.value !== '') {
      values[parameter.name] = parameter.value
    }
  }
  return values
}

export function useWriteProposedQuery() {
  const createQuery = useCreateQuery()
  const createVisualization = useCreateVisualization()
  const updateVisualization = useUpdateVisualization()
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
    proposal: NewQueryProposal & { parameters?: ChatParameterDefinition[] },
    dataSourceId: number,
    options?: {
      // What to call the visualization when the shape is the table every query
      // already has. A KPI has no second name to offer, so the query's own is
      // used for it.
      tableLabel?: string
      // A column the caller will read out of the result, which makes a failed
      // run fatal instead of cosmetic. Set by the KPI path only.
      requireColumn?: string
      idempotencyKeys?: { query: string; visualization: string }
      onCreated?: (queryId: number) => void
    }
  ): Promise<WrittenQuery> {
    const query = await createQuery.mutateAsync({
      name: proposal.name,
      description: proposal.description,
      // Byte-identical to what the validator passed, the same rule the query
      // card follows: nothing on the way here may edit it.
      query: proposal.sql,
      data_source_id: dataSourceId,
      ...(proposal.parameters && proposal.parameters.length > 0
        ? { options: { parameters: toNativeParameters(proposal.parameters) as unknown as MockQueryParameter[] } }
        : {}),
      idempotency_key: options?.idempotencyKeys?.query,
    })
    options?.onCreated?.(query.id)
    // The caller says whether a failed run is fatal, because the two want
    // opposite things: a dashboard panel that cannot run still offers Refresh, a
    // KPI that cannot run is a number that does not exist.
    let result: RedashQueryResult | undefined
    if (USE_REAL_API) {
      try {
        const defaults = defaultValues(proposal.parameters)
        result = await executeSavedQuery(query.id, {
          maxAge: 0,
          ...(Object.keys(defaults).length > 0 ? { parameters: defaults } : {}),
        })
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

    const choice = resolveVizChoice(proposal.vizChoiceId)
    const declared = sanitizedVizOptions(choice.type, proposal.vizOptions)
    const authored = { ...choice.options, ...declared }
    const vizOptions = result ? inferredVizOptions(choice.type, authored, result.data) : authored
    const isTable = choice.id === DEFAULT_VIZ_ID
    let visualizationId = query.visualizations?.[0]?.id ?? null
    if (!isTable) {
      const created = await createVisualization.mutateAsync({
        queryId: query.id,
        type: choice.type,
        name: choice.label,
        options: vizOptions,
        idempotencyKey: options?.idempotencyKeys?.visualization,
      })
      visualizationId = created.id
    }
    const tableOptions = isTable && Object.keys(declared).length > 0 ? { ...query.visualizations?.[0]?.options, ...vizOptions } : null
    if (tableOptions && visualizationId !== null) {
      await updateVisualization.mutateAsync({ queryId: query.id, vizId: visualizationId, options: tableOptions })
    }

    return {
      queryId: query.id,
      queryName: query.name,
      visualizationId,
      visualization: {
        queryName: query.name,
        type: isTable ? 'TABLE' : choice.type,
        name: isTable ? (options?.tableLabel ?? query.name) : choice.label,
        options: isTable ? (tableOptions ?? {}) : vizOptions,
      },
    }
  }

  return {
    write,
    isPending: createQuery.isPending || createVisualization.isPending || updateVisualization.isPending,
  }
}
