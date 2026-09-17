import { NextResponse, type NextRequest } from 'next/server'
import { isAnonymousPath, isEmbeddablePath } from '@/features/anonymous-routes'

// A configured deployment must not serve an app shell to a request that carries
// no session. Before this, a browser with no cookies at all could open /users,
// /settings and /admin/status: the pages rendered, then asked the client for a
// session that was never there.
//
// Mock mode is deliberately not gated. It has no backend and no secrets, and
// signing itself in is the point of a demo you can open with one URL. Sign Out
// still holds there, through the signed-out marker the auth store keeps.
//
// NEXT_PUBLIC_REDASH_URL rather than the server-side env boundary: it is the
// same value USE_REAL_API reads on the client, so the gate and the app agree on
// which mode they are in, and NEXT_PUBLIC_* vars are exempt from that boundary
// because Next inlines them.
const CONFIGURED = !!process.env.NEXT_PUBLIC_REDASH_URL

// Redash's Flask session cookie, copied onto this origin by /api/auth/login.
// Its presence is not proof of a valid session, and it is not treated as
// proof: the app still calls /api/auth/session, and every backend route
// authenticates for itself. This gate only keeps a shell away from a request
// that plainly has no credential.
const SESSION_COOKIE = 'session'

export const PUBLIC_ROUTE_HEADER = 'x-veodyn-public-route'

const IS_PROD = process.env.NODE_ENV === 'production'

/**
 * The page CSP.
 *
 * `strict-dynamic` is what makes a nonce workable in an app that code-splits:
 * the nonce authorises Next's bootstrap script, and what that script loads
 * inherits trust, so hashed chunk filenames do not each need listing. A browser
 * that honours strict-dynamic ignores `'self'` in this directive, which is
 * intended; `'self'` is there for one that does not.
 *
 * `style-src` keeps 'unsafe-inline'. React and Next both write inline style
 * attributes and there is no nonce path for those, so removing it would only
 * mean shipping a CSP that breaks the app.
 *
 * connect-src carries POSTHOG_HOST when telemetry is configured, because the
 * browser SDK posts there directly (lib/observability/TelemetryProvider.tsx).
 */
/**
 * Origins the basemap is served from.
 *
 * The map renderers hardcode Carto's two GL styles
 * (components/visualizations/map-renderer.tsx), and `map.tile_url` in the
 * instance config names a third, defaulting to MapLibre's demo tiles.
 *
 * **A style JSON and what it points at need not share an origin.** Carto serves
 * the style from basemaps.cartocdn.com and its TileJSON, vector tiles, sprite
 * and glyphs from tiles.basemaps.cartocdn.com, so listing only the first origin
 * loads the style and blocks everything in it. MapLibre fetches all of them,
 * vector tiles included, so connect-src governs the lot; img-src matters only
 * for a raster style, and it allows `https:` wholesale for an unrelated reason.
 * A custom tile_url pointing at a style whose subresources sit on a third
 * origin needs that origin here too.
 *
 * **A tile_url set only in veodyn.config.yaml is invisible here.** Middleware
 * cannot read that file, so the deployment must also set the VEODYN_MAP__TILE_URL
 * env var, which is the documented override for the same key. Getting it wrong
 * fails visibly rather than silently: the basemap does not render and the
 * browser console names the blocked origin.
 */
function mapOrigins(): string[] {
  const origins = new Set(['https://basemaps.cartocdn.com', 'https://*.basemaps.cartocdn.com'])
  const configured = process.env.VEODYN_MAP__TILE_URL ?? 'https://demotiles.maplibre.org/style.json'
  try {
    origins.add(new URL(configured).origin)
  } catch {
    // A malformed value is the config layer's problem to report, not a reason
    // to serve a page with no CSP.
  }
  return [...origins]
}

function contentSecurityPolicy(nonce: string, pathname: string): string {
  const map = mapOrigins()
  const connect = ["'self'", process.env.POSTHOG_HOST, ...map].filter(Boolean)

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${IS_PROD ? '' : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    // `https:` and not a host list, because two features take an image URL that
    // is not knowable here: a result cell renders one the QUERY AUTHOR wrote
    // (components/query/result-cell.tsx) and an avatar renders whatever a user
    // set (components/shared/user-avatar.tsx). Restricting this to self blanked
    // both. Plain http is still refused, which is the part worth keeping; XSS
    // is script-src's job, and someone who can author a query can already reach
    // an external host by other means.
    'img-src \'self\' data: blob: https:',
    "font-src 'self'",
    `connect-src ${connect.join(' ')}${IS_PROD ? '' : ' ws: wss:'}`,
    // MapLibre builds its tile workers from a blob: URL. Without this the map
    // fails to initialise at all, rather than merely losing its basemap.
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${isEmbeddablePath(pathname) ? '*' : "'none'"}`,
    ...(IS_PROD ? ['upgrade-insecure-requests'] : []),
  ].join('; ')
}

function newNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  // Built before any branch and attached to whichever answer this returns,
  // redirect included: a response that skips this is a response with no CSP.
  const nonce = newNonce()
  const csp = contentSecurityPolicy(nonce, pathname)

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  // Next reads the nonce back off this request header and stamps it onto the
  // script tags it emits. Without it the page's own bootstrap is unauthorised
  // and nothing hydrates.
  requestHeaders.set('content-security-policy', csp)

  const withCsp = (response: NextResponse) => {
    response.headers.set('Content-Security-Policy', csp)
    return response
  }
  const proceed = () => withCsp(NextResponse.next({ request: { headers: requestHeaders } }))

  // Mock mode has no backend and no session to gate, but it still gets the
  // headers: a demo build is a real deployment.
  if (!CONFIGURED) return proceed()

  if (isAnonymousPath(pathname)) {
    requestHeaders.set(PUBLIC_ROUTE_HEADER, '1')
    return proceed()
  }
  if (request.cookies.has(SESSION_COOKIE)) return proceed()

  const url = request.nextUrl.clone()
  url.pathname = '/login'
  url.search = ''
  url.searchParams.set('next', pathname + search)
  return withCsp(NextResponse.redirect(url))
}

export const config = {
  // Route handlers under /api authenticate individually and answer 401/503
  // rather than redirecting: an API caller wants a status code, not an HTML
  // sign-in page. Static assets and the favicon are excluded so the sign-in
  // page can style itself.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
}
