import { PostHog } from 'posthog-node'
import { env } from '@/lib/env'
import { isAppError } from '@/lib/errorIds'
import { scrubProperties } from './scrub'

let client: PostHog | null = null

function getClient(): PostHog | null {
  if (env.DISABLE_TELEMETRY || env.POSTHOG_KEY.length === 0 || env.POSTHOG_HOST.length === 0) {
    return null
  }
  if (client === null) {
    // flushAt 1 / flushInterval 0: a route handler can be torn down the moment
    // it responds, so a batched event would never be sent at all.
    client = new PostHog(env.POSTHOG_KEY, { host: env.POSTHOG_HOST, flushAt: 1, flushInterval: 0 })
  }
  return client
}

/** Test seam. The singleton is process-local and deliberately not shared. */
export function resetServerClient(): void {
  client = null
}

/**
 * Reports a server-side failure against the signed-in user.
 *
 * The actor id is the Redash user id, which is exactly what the browser
 * identifies with, so a 500 and the click that caused it land on one person
 * timeline with nothing passed in a header.
 */
export function captureServerError(
  actorId: string | null,
  error: unknown,
  props: Record<string, unknown> = {},
  signal?: AbortSignal,
): void {
  // An aborted request is not an incident: the caller navigated away.
  if (signal?.aborted === true) return
  const c = getClient()
  if (c === null) return
  try {
    c.captureException(
      error,
      actorId ?? 'anonymous',
      scrubProperties({ ...props, errorId: isAppError(error) ? error.id : '' }),
    )
  } catch (e) {
    console.warn('[telemetry] server capture failed', e)
  }
}
