import { scrubProperties } from './scrub'

export interface TelemetryUser {
  id: string
  name: string
  email: string
}

/**
 * The slice of posthog-js this module calls. Declared structurally and INJECTED
 * through markReady, never imported: a static import puts the 227 KB SDK in the
 * critical path of every route. TelemetryProvider imports it dynamically and
 * hands the instance over.
 */
export interface TelemetryClient {
  capture: (name: string, props?: Record<string, unknown>) => void
  captureException: (error: unknown, ctx?: Record<string, unknown>) => void
  identify: (id: string, props?: Record<string, unknown>) => void
  reset: () => void
}

let client: TelemetryClient | null = null
let warned = false
// The last requested identity, replayed if it arrives before init. React runs
// child effects first, so IdentifyUser fires before TelemetryProvider's init.
let pendingIdentity: TelemetryUser | null = null

/**
 * Events captured before the SDK arrived, replayed by markReady. The window is
 * however long the dynamic chunk takes to load, and boot is when the events
 * worth having fire. Bounded, dropping oldest-first.
 */
const MAX_BUFFERED = 50
type BufferedEvent =
  | { kind: 'capture'; name: string; props: Record<string, unknown> }
  | { kind: 'exception'; error: unknown; ctx: Record<string, unknown> }
let buffered: BufferedEvent[] = []

function buffer(event: BufferedEvent): void {
  if (buffered.length >= MAX_BUFFERED) buffered.shift()
  buffered.push(event)
}

function failOpen(e: unknown): void {
  // Warn once per session: a broken SDK would otherwise log a line per event.
  if (warned) return
  warned = true
  console.warn('[telemetry] capture failed, telemetry degraded', e)
}

function doIdentify(u: TelemetryUser): void {
  if (!client) return
  try {
    // The identified person is the signed-in Redash user.
    client.identify(u.id, { name: u.name, email: u.email })
  } catch (e) {
    failOpen(e)
  }
}

/**
 * Hand over the initialised SDK, or `null` to stand telemetry back down. Also
 * the readiness gate and the replay point. Identity is replayed FIRST, or the
 * replayed events are attributed to nobody.
 */
export function markReady(next: TelemetryClient | null): void {
  client = next
  if (!next) {
    // Standing down: held events would otherwise replay a signed-out session's
    // events into whatever comes next.
    buffered = []
    return
  }
  if (pendingIdentity !== null) doIdentify(pendingIdentity)
  const replay = buffered
  buffered = []
  for (const event of replay) {
    if (event.kind === 'capture') send(event.name, event.props)
    else sendException(event.error, event.ctx)
  }
}

export function currentRoute(): string {
  return typeof window === 'undefined' ? '' : window.location.pathname
}

/** Already scrubbed by the time it gets here, whether live or replayed. */
function send(name: string, props: Record<string, unknown>): void {
  try {
    client?.capture(name, props)
  } catch (e) {
    failOpen(e)
  }
}

function sendException(error: unknown, ctx: Record<string, unknown>): void {
  try {
    client?.captureException(error, ctx)
  } catch (e) {
    failOpen(e)
  }
}

export function capture(name: string, props: Record<string, unknown> = {}): void {
  // Scrubbed on the way IN, not on the way out of the buffer: the props are the
  // caller's object, and an unscrubbed reference held until replay leaks.
  const scrubbed = scrubProperties(props)
  if (!client) {
    buffer({ kind: 'capture', name, props: scrubbed })
    return
  }
  send(name, scrubbed)
}

export function captureException(error: unknown, ctx: Record<string, unknown> = {}): void {
  const scrubbed = scrubProperties(ctx)
  if (!client) {
    buffer({ kind: 'exception', error, ctx: scrubbed })
    return
  }
  sendException(error, scrubbed)
}

export function identifyUser(u: TelemetryUser): void {
  pendingIdentity = u
  if (!client) return
  doIdentify(u)
}

export function resetIdentity(): void {
  // Drop the pending IDENTITY, so a sign-out before init is not re-identified
  // once telemetry becomes ready. Not the event buffer: those events happened.
  pendingIdentity = null
  if (!client) return
  try {
    client.reset()
  } catch (e) {
    failOpen(e)
  }
}
