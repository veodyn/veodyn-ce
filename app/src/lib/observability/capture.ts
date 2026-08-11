import { scrubProperties } from './scrub'

export interface TelemetryUser {
  id: string
  name: string
  email: string
}

/**
 * The slice of posthog-js this module actually calls.
 *
 * Declared structurally, and INJECTED through markReady, rather than imported.
 * `import posthog from 'posthog-js'` here put the 227 KB SDK in the client
 * graph of everything that captures an event, which is most of the app, so it
 * landed in the critical path of every route including /login. Nothing on that
 * path needs the SDK before hydration: TelemetryProvider imports it
 * dynamically, after init has been decided on, and hands the instance over.
 *
 * A structural type rather than `typeof import('posthog-js').default` so this
 * file names only what it uses and a test double is a plain object.
 */
export interface TelemetryClient {
  capture: (name: string, props?: Record<string, unknown>) => void
  captureException: (error: unknown, ctx?: Record<string, unknown>) => void
  identify: (id: string, props?: Record<string, unknown>) => void
  reset: () => void
}

let client: TelemetryClient | null = null
let warned = false
// The last requested identity, held so an identify that arrives before init has
// landed is replayed rather than dropped. React runs child effects before parent
// effects, so IdentifyUser fires before TelemetryProvider's posthog.init, and
// now the dynamic import puts a further tick between them.
let pendingIdentity: TelemetryUser | null = null

/**
 * Events captured before the SDK arrived, replayed by markReady.
 *
 * Needed BECAUSE of the dynamic import. While posthog-js was a static import,
 * init ran synchronously inside the provider's effect and the unready window
 * was effectively zero; now it is however long the chunk takes to fetch and
 * parse. Boot is exactly when the events worth having are fired, so dropping
 * that window silently would have paid for the bundle win with the errors that
 * explain a bad load.
 *
 * Bounded, and oldest-first: this is a buffer for a window measured in
 * milliseconds, so if it ever fills, something is wrong and the recent events
 * are the informative ones. A telemetry buffer must never be the reason a tab
 * runs out of memory.
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
  // Warn once per session. A broken SDK would otherwise emit a line per event,
  // and the test setup enforces a repeat budget on console output.
  if (warned) return
  warned = true
  console.warn('[telemetry] capture failed, telemetry degraded', e)
}

function doIdentify(u: TelemetryUser): void {
  if (!client) return
  try {
    // The identified person is the signed-in Redash user, which on the stage
    // deployment is a member of the team, not a tenant's end customer.
    client.identify(u.id, { name: u.name, email: u.email })
  } catch (e) {
    failOpen(e)
  }
}

/**
 * Hand over the initialised SDK, or `null` to stand telemetry back down.
 *
 * Also the readiness gate, and the point at which anything captured during the
 * dynamic import is replayed. Identity is replayed first: an event that arrives
 * before its person does would otherwise be attributed to nobody.
 */
export function markReady(next: TelemetryClient | null): void {
  client = next
  if (!next) {
    // Standing down. Holding events for an SDK that is not coming back would
    // replay a signed-out session's events into whatever comes next.
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
  // Scrubbed on the way IN, not on the way out of the buffer: the properties
  // are the caller's object, and holding a reference to an unscrubbed one until
  // replay is how a value that was sensitive at capture time leaks later.
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
  // Drop the pending IDENTITY, so a sign-out before init does not get
  // re-identified when telemetry becomes ready a moment later. Deliberately not
  // the event buffer: those events happened, and they belong to the session
  // that is ending rather than to nobody.
  pendingIdentity = null
  if (!client) return
  try {
    client.reset()
  } catch (e) {
    failOpen(e)
  }
}
