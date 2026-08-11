import { isAppError } from '@/lib/errorIds'
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
  capture(EVENTS.queryFailed, {
    queryKey: typeof head === 'string' ? head : 'unknown',
    errorId: isAppError(error) ? error.id : '',
    status: isAppError(error) && typeof error.context.status === 'number' ? error.context.status : 0,
    route: currentRoute(),
  })
}
