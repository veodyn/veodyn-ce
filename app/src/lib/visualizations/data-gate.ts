// Whether a visualization may draw without a query result, and what to hand it
// when it draws without one.
//
// Each render surface used to decide this for itself, in its own conditional,
// and they disagreed: a 0-row result drew on a dashboard and in a query tab,
// and said "No data" on the wall, in a report block and in the editor preview.
// That was survivable while every type was a view of the rows its query
// returned.
//
// It stops being survivable once a plugin can be arbitrary code that draws from
// an external feed, from another query, or from nothing at all. Such a type
// could never render on four of the six surfaces, and nothing would have failed
// to say so. The question moves here, and each surface asks it instead of
// answering it.
import type { QueryResultData } from '@/lib/mock-data'
import { getVisualization } from './registry'

/**
 * Handed to a type that declares `needs: 'none'` when there is no result.
 *
 * A well-formed empty result rather than undefined, so a plugin that ignores
 * its data never has to type-guard the argument and every core renderer keeps
 * a required `data` prop. Frozen because one object is shared by every dataless
 * widget on the page, and a renderer that wrote through it would corrupt the
 * others.
 */
export const EMPTY_QUERY_RESULT: QueryResultData = { columns: [], rows: [] }
Object.freeze(EMPTY_QUERY_RESULT.columns)
Object.freeze(EMPTY_QUERY_RESULT.rows)
Object.freeze(EMPTY_QUERY_RESULT)

/**
 * Whether a saved visualization of this type has to wait for a query result.
 *
 * An unregistered type needs one. That is the conservative direction: an
 * unknown type keeps the surface's existing "No data" branch rather than being
 * mounted against nothing on the strength of a lookup that missed.
 */
export function needsQueryResult(type: string): boolean {
  return (getVisualization(type)?.needs ?? 'query-result') === 'query-result'
}

export interface VisualizationDataOptions {
  /**
   * Treat a result with no rows as no result.
   *
   * Surface policy, not type policy, and deliberately still a parameter: the
   * six surfaces genuinely disagree about it today and unifying them here would
   * change what every existing core visualization does on two of them. Passing
   * it explicitly makes the disagreement visible at each call site instead of
   * buried in six different conditionals.
   */
  requireRows?: boolean
}

/**
 * The result to hand VisualizationRenderer, or null when the surface should
 * show its own empty state instead.
 */
export function visualizationData(
  type: string,
  result: QueryResultData | null | undefined,
  { requireRows = false }: VisualizationDataOptions = {}
): QueryResultData | null {
  if (!needsQueryResult(type)) return result ?? EMPTY_QUERY_RESULT
  if (!result) return null
  if (requireRows && result.rows.length === 0) return null
  return result
}
