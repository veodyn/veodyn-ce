import { redactUrl } from './redactPath'

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
  'errorName',
  'status',
  'level',
  'queryKey',
  'vizType',
  'kind',
  'digest',
  'surface',
  'reason',
])

const REQUIRED_BY_INGESTION: ReadonlySet<string> = new Set(['token', 'distinct_id'])

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
    if (key.startsWith('$') || SAFE_KEYS.has(key)) {
      out[key] = redactTokenPaths(value)
      continue
    }
    out[key] = REDACTED
  }
  return out
}

function redactTokenPaths(value: unknown): unknown {
  if (typeof value === 'string') return redactUrl(value)
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const out: Record<string, unknown> = {}
    for (const [key, inner] of Object.entries(value)) out[key] = typeof inner === 'string' ? redactUrl(inner) : inner
    return out
  }
  return value
}

export function scrubEvent<T extends { properties?: Record<string, unknown> } | null>(event: T): T {
  if (event === null) return event
  if (event.properties !== undefined) event.properties = scrubProperties(event.properties)
  return event
}
