/**
 * The pure decisions the catch-all proxy makes about a request, kept beside it.
 * Everything here is a predicate or a string transform with no I/O, so the
 * route handler stays the only place that talks to the network.
 */

import type { NextRequest } from 'next/server'

/**
 * Whether a response body can be read as text without damaging it.
 *
 * Deliberately matched on the type rather than on a substring: xlsx is
 * `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, which
 * contains "xml" twice and is not text at all.
 */
export function isTextualContentType(contentType: string): boolean {
  const type = contentType.split(';')[0].trim().toLowerCase()
  if (type === '') return true
  if (type.startsWith('text/')) return true
  if (type.endsWith('+json') || type.endsWith('+xml')) return true
  return ['application/json', 'application/xml', 'application/javascript'].includes(type)
}

// Paths reachable without a session cookie or API key. Everything else is
// rejected in the handler so unauthenticated requests never reach Redash;
// authenticated ones are enforced by Redash itself via the forwarded session
// cookie.
export function isPublicPath(path: string[]): boolean {
  const joined = path.join('/')
  return (
    joined === 'ping' ||
    joined === 'session' ||
    joined.startsWith('dashboards/public/') ||
    // A per-visualization share token, the embed equivalent of the dashboard
    // one above. The token in the path is the entire credential, so this
    // request arrives with no session and no key by design.
    joined.startsWith('visualizations/public/') ||
    // Invite/reset token endpoints: the token itself is the credential
    (path.length === 2 && (path[0] === 'invite' || path[0] === 'reset'))
  )
}

// The copyable URL the query API-key dialog hands out: a results path whose
// ?api_key= is the entire credential, validated by Redash itself
// (get_api_key_from_request reads request.args first). Scoped to the results
// shapes (queries/<id>/results, results.<filetype>, results/<result_id>) so
// the key-in-URL door opens nothing else.
export function isKeyedResultsPath(request: NextRequest, path: string[]): boolean {
  return (
    !!request.nextUrl.searchParams.get('api_key') &&
    path[0] === 'queries' &&
    path.length >= 3 &&
    (path[2] === 'results' || path[2].startsWith('results.'))
  )
}

// Our origin-only cookies must not leak to Redash: `redash_api_key` holds the
// user's key (sent as an Authorization header instead).
export function stripOwnCookies(cookieHeader: string): string {
  return cookieHeader
    .split(';')
    .map((c) => c.trim())
    .filter((c) => !c.startsWith('redash_api_key='))
    .join('; ')
}
