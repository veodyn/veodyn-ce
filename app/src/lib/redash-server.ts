/**
 * Server-side Redash helpers for Next.js API routes (auth + admin).
 *
 * Regular data traffic goes through the /api/node/[...path] proxy with the
 * user's own session cookie so Redash enforces per-user permissions. These
 * helpers exist for the routes that can't be a straight pass-through: the
 * login form dance, session checks, and admin endpoints that live outside
 * Redash's /api/* namespace.
 */

import { env } from './env'
import { AppError, ErrorIds } from './errorIds'

export const REDASH_URL = env.REDASH_URL

/** Permission strings Redash puts on a session (redash/permissions.py). */
export type RedashPermission = 'admin' | 'super_admin'

/** A session THIS app verified against Redash, for the request in hand. */
export interface VerifiedSession {
  id: number
  permissions: string[]
}

/**
 * Every Redash path this app may reach with the internal API key, mapped to the
 * permission Redash's own handler demands of the caller.
 *
 * THE RULE: the gate in front of the internal key must be at least as strong as
 * the gate Redash puts on the endpoint being proxied. The key is a Redash
 * *user* api_key, run with its owner's super_admin permissions and never the
 * caller's, so a route gated on `admin` would hand an org admin an
 * instance-wide endpoint Redash itself refuses them.
 *
 * Adding a route that needs the key: read the decorator on the Redash handler
 * and add the path here with that permission. `redashFetch` refuses the key for
 * an undeclared path or an insufficient session, and
 * `src/lib/internal-key-gate.test.ts` fails if an entry here is weaker than the
 * decorator it mirrors.
 */
export const INTERNAL_KEY_ENDPOINTS = {
  // redash/handlers/__init__.py: @login_required @require_super_admin
  '/status.json': 'super_admin',
  // redash/handlers/admin.py: @require_super_admin @login_required
  '/api/admin/queries/outdated': 'super_admin',
  '/api/admin/queries/rq_status': 'super_admin',
} as const satisfies Record<string, RedashPermission>

export type InternalKeyPath = keyof typeof INTERNAL_KEY_ENDPOINTS

export class RedashError extends Error {
  constructor(
    public status: number,
    public body: string
  ) {
    super(`Redash ${status}: ${body}`)
    this.name = 'RedashError'
  }
}

export interface RedashFetchOptions {
  method?: string
  body?: unknown
  headers?: Record<string, string>
  /** Cookie header string to forward (typically request.headers.get('cookie')) */
  cookie?: string | null
  /**
   * Authenticate with the internal API key on behalf of this session instead of
   * with cookies. A session rather than a boolean: it is checked against
   * INTERNAL_KEY_ENDPOINTS for `path` before the key goes anywhere.
   */
  internalKeyFor?: VerifiedSession
  /** Abort signal forwarded to the underlying fetch so callers can cancel. */
  signal?: AbortSignal
}

/**
 * The internal API key, or a throw. Every caller of the key comes through
 * here, so the permission check cannot be skipped by reaching for the key
 * directly: nothing else in the app can read it.
 */
function internalApiKeyFor(path: string, session: VerifiedSession): string {
  const required: RedashPermission | undefined =
    INTERNAL_KEY_ENDPOINTS[path as InternalKeyPath]

  if (!required) {
    throw new AppError(
      ErrorIds.AUTH_INTERNAL_KEY_UNGATED,
      'Refusing the internal API key for a path with no declared Redash gate.',
      { path }
    )
  }
  if (!session.permissions.includes(required)) {
    throw new AppError(
      ErrorIds.AUTH_FORBIDDEN,
      'Refusing the internal API key for a session weaker than the Redash gate.',
      { path, required, userId: session.id }
    )
  }

  const key = env.REDASH_INTERNAL_API_KEY || env.REDASH_API_KEY
  if (!key) {
    throw new AppError(
      ErrorIds.CFG_ENV_MISSING,
      'REDASH_INTERNAL_API_KEY is not configured.',
      { path }
    )
  }
  return key
}

/**
 * Fetch from the Redash backend. `path` is relative to the Redash root
 * (e.g. '/api/session', '/login', '/status.json').
 */
export async function redashFetch(
  path: string,
  options: RedashFetchOptions = {}
): Promise<Response> {
  const { method = 'GET', body, headers = {}, cookie, internalKeyFor, signal } = options

  const reqHeaders: Record<string, string> = { ...headers }

  if (internalKeyFor) {
    reqHeaders['Authorization'] = `Key ${internalApiKeyFor(path, internalKeyFor)}`
  } else if (cookie) {
    reqHeaders['Cookie'] = cookie
  }

  if (body !== undefined && !reqHeaders['Content-Type']) {
    reqHeaders['Content-Type'] = 'application/json'
  }

  return fetch(`${REDASH_URL}${path}`, {
    method,
    headers: reqHeaders,
    body:
      body === undefined
        ? undefined
        : typeof body === 'string'
          ? body
          : JSON.stringify(body),
    redirect: 'manual',
    cache: 'no-store',
    signal,
  })
}

/**
 * Parse Set-Cookie headers into a name → value map (last wins).
 */
export function parseSetCookieHeaders(response: Response): Map<string, string> {
  const result = new Map<string, string>()
  const setCookies = response.headers.getSetCookie?.() ?? []
  for (const raw of setCookies) {
    const [nameValue] = raw.split(';')
    const eqIdx = nameValue.indexOf('=')
    if (eqIdx > 0) {
      result.set(nameValue.slice(0, eqIdx).trim(), nameValue.slice(eqIdx + 1).trim())
    }
  }
  return result
}

export function buildCookieHeader(cookies: Map<string, string>): string {
  return Array.from(cookies.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')
}

/**
 * Forward Redash's raw Set-Cookie headers onto a Next.js response.
 * Stock Redash refreshes its `session` and `csrf_token` cookies on responses;
 * re-emitting them keeps the browser's cookies (scoped to our origin) fresh.
 */
export function forwardSetCookies(from: Response, to: Response): void {
  const setCookies = from.headers.getSetCookie?.() ?? []
  for (const raw of setCookies) {
    to.headers.append('Set-Cookie', raw)
  }
}

/**
 * Verify the caller's OWN session against Redash. Returns the session user, or
 * null when the cookie is missing, expired, or not a real session. Imposes no
 * permission requirement: the gate for routes that need a signed-in user and
 * nothing more (the AI relay, which must not spend provider quota anonymously).
 */
export async function requireSession(
  cookie: string | null,
  signal?: AbortSignal
): Promise<{ id: number } | null> {
  if (!cookie) return null
  try {
    const res = await redashFetch('/api/session', { cookie, signal })
    if (!res.ok) return null
    const data = await res.json()
    const id = data?.user?.id
    return typeof id === 'number' ? { id } : null
  } catch {
    return null
  }
}

/**
 * Verify the caller's OWN session carries `permission`. This is the gate in
 * front of every internal-key call, and the permission is not the route
 * author's to pick: it comes from INTERNAL_KEY_ENDPOINTS above, which mirrors
 * Redash's own decorator. Returns the verified session, or null when the
 * caller is anonymous or lacks the permission.
 */
export async function requirePermission(
  cookie: string | null,
  permission: RedashPermission,
  signal?: AbortSignal
): Promise<VerifiedSession | null> {
  if (!cookie) return null
  try {
    const res = await redashFetch('/api/session', { cookie, signal })
    if (!res.ok) return null
    const data = await res.json()
    const permissions: unknown = data?.user?.permissions
    const id: unknown = data?.user?.id
    if (typeof id !== 'number' || !Array.isArray(permissions)) return null
    if (!permissions.includes(permission)) return null
    return { id, permissions }
  } catch {
    return null
  }
}
