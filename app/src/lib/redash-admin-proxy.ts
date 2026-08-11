/**
 * The one way this app reaches a Redash endpoint with the internal API key.
 *
 * Every /api/admin/* route handler is this function plus a path. The path, not
 * the route author, decides the permission the caller's own session has to
 * carry: it is looked up in INTERNAL_KEY_ENDPOINTS (src/lib/redash-server.ts),
 * which mirrors the decorator on Redash's own handler. Read THE RULE beside
 * that table before adding a route that needs the key.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { AppError, ErrorIds } from './errorIds'
import {
  INTERNAL_KEY_ENDPOINTS,
  REDASH_URL,
  redashFetch,
  requirePermission,
  type InternalKeyPath,
  type RedashPermission,
} from './redash-server'

const DENIED_MESSAGE: Record<RedashPermission, string> = {
  admin: 'Admin permission required.',
  super_admin: 'Super admin permission required.',
}

/**
 * GET `path` from Redash with the internal API key, after verifying the
 * caller's own session carries what Redash requires for it.
 */
export async function proxyWithInternalKey(
  request: NextRequest,
  path: InternalKeyPath
): Promise<NextResponse> {
  if (!REDASH_URL) {
    return NextResponse.json({ message: 'REDASH_URL not configured.' }, { status: 503 })
  }

  const required: RedashPermission = INTERNAL_KEY_ENDPOINTS[path]
  const session = await requirePermission(
    request.headers.get('cookie'),
    required,
    request.signal
  )
  if (!session) {
    return NextResponse.json({ message: DENIED_MESSAGE[required] }, { status: 403 })
  }

  try {
    const res = await redashFetch(path, { internalKeyFor: session, signal: request.signal })
    if (!res.ok) {
      return NextResponse.json({ message: 'Fetch failed.' }, { status: res.status })
    }
    const data = await res.json()
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    if (err instanceof AppError) {
      if (err.id === ErrorIds.CFG_ENV_MISSING) {
        return NextResponse.json(
          { message: 'The query service internal API key is not configured.' },
          { status: 503 }
        )
      }
      // A refused key is this app's own bug (an unregistered path, or a gate
      // weaker than the endpoint's). Let it out rather than reporting it as an
      // unreachable backend, which would read as an outage and get retried.
      throw err
    }
    return NextResponse.json({ message: 'Failed to reach the query service.' }, { status: 502 })
  }
}
