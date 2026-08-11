// How an MCP tool reaches Redash, and as whom.
//
// The identity rule is the one the KPI service learned the hard way: exactly
// ONE credential establishes who the caller is, and only that credential is
// forwarded. Sending a user's API key alongside a session cookie lets whichever
// Redash resolves first decide the permissions, which is how a client ends up
// reading a query its own identity may not run.

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
 * Pick the single credential.
 *
 * The Cookie header is parsed rather than passed through. This origin's own
 * login route sets three cookies: `session`, `csrf_token`, and `redash_api_key`
 * holding the user's Redash API key. Forwarding the header whole sent Redash
 * all three, which is the exact "two credentials, let the server pick" mistake
 * the rule above exists to prevent, and it put an API key on the wire for a
 * request that never needed one.
 *
 * Order of preference: an explicit Authorization header, then the stored
 * `redash_api_key` cookie, then the session cookie. This is the order the
 * ordinary proxy already uses (`src/app/api/node/[...path]/route.ts`), and
 * one order for the whole origin is the point: a browser must not get a
 * different identity depending on which of our endpoints it reaches.
 *
 * The header wins because sending it is a deliberate act by an MCP client. The
 * stored key beats the session for the reason the proxy gives: an API-key
 * request is CSRF-exempt, while Flask-WTF refuses a cookie-authenticated POST
 * that arrives without `X-CSRF-TOKEN`. Login writes `session` and
 * `redash_api_key` for 30 days but `csrf_token` only for the browser session,
 * so "session and key, no CSRF" is simply what reopening the browser looks
 * like. Preferring the session there broke `run_query` for exactly those
 * callers while the rest of the app kept working.
 *
 * The key is minted from the session at login and cleared with it, so the two
 * name the same user. If that ever stops being true it is an origin-wide
 * problem to fix in one place, not something for this endpoint to answer
 * differently from every other route.
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
 * Whether this request carries something that could be an identity.
 *
 * Only a recognised credential counts. Any non-empty Cookie header used to pass
 * here, so `Cookie: theme=dark` was enough to get an anonymous caller past the
 * gate and have the endpoint make Redash requests on their behalf.
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
    // Redash answers an unrecognised API key with 404 and this message, not
    // with 401, so that an unauthenticated caller cannot probe for what exists.
    // Reporting it as "no such object" would send someone with a typo in their
    // key hunting for a query that is sitting right there.
    if (response.status === 404 && /please login/i.test(body)) {
      throw new McpUnauthorized(
        'The query service did not recognise this credential. Check the API key: it is the one on your profile page, sent as `Authorization: Key <key>`.'
      )
    }
    throw new RedashError(response.status, body)
  }
  return (await response.json()) as T
}
