import { isAppError } from '@/lib/errorIds'
import { ApiError } from '@/services/api-client'
import { VizError } from '@veodyn/viz/lib/visualizations/viz-error'
import { capture, currentRoute } from './capture'
import { EVENTS } from './events'

function statusOf(error: unknown): number {
  if (error instanceof ApiError) return error.status
  if ((isAppError(error) || error instanceof VizError) && typeof error.context.status === 'number') {
    return error.context.status
  }
  return 0
}

export function reportQueryError(error: unknown, queryKey: readonly unknown[]): void {
  const head = queryKey[0]
  const known = isAppError(error) || error instanceof VizError ? error : null
  capture(EVENTS.queryFailed, {
    queryKey: typeof head === 'string' ? head : 'unknown',
    errorId: known ? known.id : '',
    status: statusOf(error),
    errorName: error instanceof Error ? error.name : 'unknown',
    route: currentRoute(),
  })
}
