const REDACTED = '[redacted]'
const MESSAGE_CAP = 200

// The only property keys allowed to carry a raw value; everything else is
// redacted, because a property derived from a tenant's query result must never
// leave the browser. An allow-list, so an unlisted new property is redacted.
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

// posthog-js carries the project api_key in `properties.token` and ingestion
// resolves the team from it, so redacting it drops every event silently: the
// capture endpoint still answers `200 {"status":"Ok"}`. It is the public client
// ingestion key, so keeping it leaks nothing.
const REQUIRED_BY_INGESTION: ReadonlySet<string> = new Set(['token'])

export function scrubProperties(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props)) {
    if (REQUIRED_BY_INGESTION.has(key)) {
      out[key] = value
      continue
    }
    // App copy, but it can interpolate an object name, so cap it.
    if (key === 'message' && typeof value === 'string') {
      out[key] = value.slice(0, MESSAGE_CAP)
      continue
    }
    // `$`-prefixed keys are posthog's own ($current_url, $exception_list).
    // Redacting them breaks autocapture and replay stitching.
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
