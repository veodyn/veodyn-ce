const REDACTED = '[redacted]'
const MESSAGE_CAP = 200

// The complete set of property keys allowed to carry a raw value. Everything
// else is redacted, because veodyn renders tenant data and a property derived
// from a query result must never leave the browser.
//
// An allow-list rather than a deny-list on purpose. A deny-list has to predict
// the key names that will carry data, and it is wrong the first time somebody
// adds a property nobody thought about. This is wrong in the safe direction: a
// new property is redacted until someone adds it here deliberately.
export const SAFE_KEYS: ReadonlySet<string> = new Set([
  'app',
  'release',
  'commit',
  'org',
  'route',
  'errorId',
  'status',
  'level',
  'queryKey',
  'vizType',
  'kind',
  'digest',
  'surface',
  'reason',
])

// posthog-js carries the project api_key in `properties.token`, and the
// ingestion pipeline resolves the team from it. This is NOT covered by the
// `$`-prefix rule below, and redacting it fails silently in the worst way: the
// capture endpoint still answers `200 {"status":"Ok"}` because it validates the
// token's SHAPE and not its existence, and the event is dropped much later when
// no team matches. Every event this app sent was lost that way until 2026-08-05,
// with nothing in the console and a success status on the wire.
//
// posthog-js publishes exactly this one property as unsafe for a `before_send`
// hook to touch (`knownUnsafeEditableEventProperty === ['token']`). It warns
// when a hook REMOVES one, which is why nothing warned here: we overwrote the
// value rather than deleting the key.
//
// Keeping it costs no privacy. It is the client ingestion key posthog-js ships
// to every browser, and it sits in the Helm values in the clear.
const REQUIRED_BY_INGESTION: ReadonlySet<string> = new Set(['token'])

export function scrubProperties(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props)) {
    if (REQUIRED_BY_INGESTION.has(key)) {
      out[key] = value
      continue
    }
    // App copy rather than query data, but it can interpolate an object name,
    // so it is capped rather than passed through at any length.
    if (key === 'message' && typeof value === 'string') {
      out[key] = value.slice(0, MESSAGE_CAP)
      continue
    }
    // `$`-prefixed keys are posthog's own ($current_url, $exception_list and so
    // on). Redacting them would break autocapture and replay stitching.
    if (key.startsWith('$') || SAFE_KEYS.has(key)) {
      out[key] = value
      continue
    }
    out[key] = REDACTED
  }
  return out
}

export function scrubEvent<T extends { properties?: Record<string, unknown> } | null>(event: T): T {
  if (event === null) return event
  if (event.properties !== undefined) event.properties = scrubProperties(event.properties)
  return event
}
