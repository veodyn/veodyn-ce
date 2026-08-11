import { NextResponse, type NextRequest } from 'next/server'

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

// Routes that exist precisely for people who have no session, plus the ones an
// anonymous link is supposed to reach. Written without a trailing slash and
// matched on a segment boundary below.
const PUBLIC_ROUTES = [
  '/login',
  '/invite',
  '/reset',
  '/embed',
  '/dashboards/public',
  '/reports/public',
  // Not public: /mcp authenticates for itself, with a Redash API key rather
  // than a browser session. Redirecting it to an HTML sign-in page would break
  // every MCP client, which wants a status code and a JSON body.
  '/mcp',
]

/**
 * Segment-bounded, not a bare startsWith. A prefix test would exempt any future
 * route that merely begins with these characters: /mcp would open /mcp-admin,
 * /login would open /loginhistory, and /reports/public would open
 * /reports/publications, which is an analyst route rather than an anonymous
 * link. This is an authorization gate, so it fails closed on anything it was
 * not told about.
 */
function isPublic(pathname: string): boolean {
  return PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  )
}

// Redash's Flask session cookie, copied onto this origin by /api/auth/login.
// Its presence is not proof of a valid session, and it is not treated as
// proof: the app still calls /api/auth/session, and every backend route
// authenticates for itself. This gate only keeps a shell away from a request
// that plainly has no credential.
const SESSION_COOKIE = 'session'

/**
 * Marks a request as one of the PUBLIC_ROUTES for the root layout.
 *
 * The layout reads the caller's session server-side, which for a public route
 * is a Redash round trip in front of HTML that will never look at the answer.
 * An anonymous recipient does not pay it (no cookie, so there is nothing to
 * ask about), but a signed-in reader opening a share link does, and on an
 * embed that latency is the whole product. This is the one place that already
 * knows whether a path is public, and repeating that list in the layout is how
 * the two would drift.
 */
export const PUBLIC_ROUTE_HEADER = 'x-veodyn-public-route'

function markPublic(request: NextRequest) {
  const headers = new Headers(request.headers)
  headers.set(PUBLIC_ROUTE_HEADER, '1')
  return NextResponse.next({ request: { headers } })
}

export function middleware(request: NextRequest) {
  if (!CONFIGURED) return NextResponse.next()

  const { pathname, search } = request.nextUrl
  if (isPublic(pathname)) return markPublic(request)
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next()

  const url = request.nextUrl.clone()
  url.pathname = '/login'
  url.search = ''
  url.searchParams.set('next', pathname + search)
  return NextResponse.redirect(url)
}

export const config = {
  // Route handlers under /api authenticate individually and answer 401/503
  // rather than redirecting: an API caller wants a status code, not an HTML
  // sign-in page. Static assets and the favicon are excluded so the sign-in
  // page can style itself.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
}
