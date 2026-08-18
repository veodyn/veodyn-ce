// How an MCP tool reaches Redash, and as whom.
//
// Identity rule: exactly ONE credential is forwarded. Sending an API key
// alongside a session cookie lets whichever Redash resolves first decide the
// permissions.

import { redashFetch, RedashError } from '@/lib/redash-server'

export interface McpCredential {
  /** Redash user API key, from `Authorization: Key <key>` or `Bearer <key>`. */
  apiKey: string | null
  /** Flask session value, forwarded as a lone `session` cookie. */
  session: string | null
  /** Redash's CSRF token, required alongside the session on a mutation. */
  csrfToken: string | null
}

const EMPTY: McpCredential = { apiKey: null, session: null, csrfToken: null }

/**
 * Pick the single credential. The Cookie header is parsed, never passed
 * through: login sets `session`, `csrf_token` and `redash_api_key`, and
 * forwarding all three is the two-credential mistake above.
 *
 * Preference order, the same one `src/app/api/node/[...path]/route.ts` uses so
 * the whole origin resolves one identity: Authorization header, then the
 * `redash_api_key` cookie, then `session`. The stored key beats the session
 * because an API-key request is CSRF-exempt while Flask-WTF refuses a
 * cookie-authenticated POST with no `X-CSRF-TOKEN`, and `csrf_token` lasts only
 * the browser session while the other two last 30 days.
 */
export function resolveCredential(
  authorization: string | null,
  cookie: string | null
): McpCredential {
  const explicit = parseApiKey(authorization)
  if (explicit) return { ...EMPTY, apiKey: explicit }

  const cookies = parseCookies(cookie)
  const storedKey = cookies.get('redash_api_key')
  if (storedKey) return { ...EMPTY, apiKey: storedKey }

  const session = cookies.get('session')
  if (session) {
    return { ...EMPTY, session, csrfToken: cookies.get('csrf_token') ?? null }
  }

  return EMPTY
}

export function parseApiKey(authorization: string | null): string | null {
  if (!authorization) return null
  const match = authorization.match(/^(?:Key|Bearer)\s+(.+)$/i)
  return match ? match[1].trim() : null
}

export function parseCookies(header: string | null): Map<string, string> {
  const jar = new Map<string, string>()
  if (!header) return jar
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    const name = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1).trim()
    if (name && value) jar.set(name, value)
  }
  return jar
}

/**
 * Whether this request carries an identity. Only a recognised credential
 * counts: an unrelated cookie must not get an anonymous caller past the gate.
 */
export function hasCredential(credential: McpCredential): boolean {
  return Boolean(credential.apiKey || credential.session)
}

export class McpUnauthorized extends Error {}

/**
 * A Redash call as the caller. Never as the instance: this endpoint must not
 * become a way to read data through the service account.
 */
export async function callRedash<T>(
  path: string,
  credential: McpCredential,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {}
): Promise<T> {
  const headers: Record<string, string> = {}
  if (credential.apiKey) {
    headers.Authorization = `Key ${credential.apiKey}`
  } else if (credential.csrfToken) {
    // Redash is Flask-WTF protected: a cookie-authenticated POST without this
    // header is refused, so a browser-session run_query would fail on any
    // instance with CSRF on.
    headers['X-CSRF-TOKEN'] = credential.csrfToken
  }

  const response = await redashFetch(path, {
    method: init.method,
    body: init.body,
    // Only the session cookie, rebuilt: never the caller's whole jar.
    cookie: credential.session ? `session=${credential.session}` : null,
    headers,
    signal: init.signal,
  })

  if (response.status === 401 || response.status === 403) {
    throw new McpUnauthorized(
      'The query service refused this credential for that object. Check that the API key belongs to a user who can see it.'
    )
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    // Redash answers an unrecognised API key with 404 and this message rather
    // than 401, so an unauthenticated caller cannot probe for what exists.
    if (response.status === 404 && /please login/i.test(body)) {
      throw new McpUnauthorized(
        'The query service did not recognise this credential. Check the API key: it is the one on your profile page, sent as `Authorization: Key <key>`.'
      )
    }
    throw new RedashError(response.status, body)
  }
  return (await response.json()) as T
}
