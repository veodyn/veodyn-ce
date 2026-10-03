import { isAppError } from '@/lib/errorIds'
import { VizError } from '@veodyn/viz/lib/visualizations/viz-error'
import { capture, currentRoute } from './capture'
import { EVENTS } from './events'

/**
 * Reports a failed query or mutation.
 *
 * This catches the failures nothing else sees. A query whose consumer
 * destructures `{ data, isLoading }` and never checks `isError` renders a failed
 * fetch as "nothing here": no toast, no throw, and an autocaptured click that
 * looks like it worked. Only the cache knows it failed.
 */
export function reportQueryError(error: unknown, queryKey: readonly unknown[]): void {
  // Only the first segment, and only when it is a string. Later segments carry
  // ids and filter objects, and a filter can hold a search term the user typed.
  const head = queryKey[0]
  const known = isAppError(error) || error instanceof VizError ? error : null
  capture(EVENTS.queryFailed, {
    queryKey: typeof head === 'string' ? head : 'unknown',
    errorId: known ? known.id : '',
    status: known && typeof known.context.status === 'number' ? known.context.status : 0,
    route: currentRoute(),
  })
}
