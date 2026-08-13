/**
 * The addresses this product serves to somebody who is not signed in.
 *
 * None of them is a Redash address. `/dashboards/public/<token>` and
 * `/embed/public/<token>` are Next routes in this app, and the query results
 * API is the proxy itself: `api/node/[...path]` lets those token paths and the
 * `?api_key=`-carrying results paths through without a session. So the link a
 * reader should be handed is always built from this origin, and the credential
 * in the URL is the whole of what it grants.
 *
 * Redash also mints a `public_url`, and it is not that link. It is
 * `/public/dashboards/<token>` (the segments are the other way round) on
 * whatever host Redash was configured with, which in a Kubernetes deployment is
 * the in-cluster service name. Stage handed out
 * `http://flow-dev-redash/public/dashboards/…` under the heading "Anyone with
 * the link can view this dashboard", and that host resolves for nobody outside
 * the cluster. Reading the origin off the window cannot be misconfigured from
 * outside, which is the actual point: the embed dialog has always built its
 * link this way, and only the dashboard one trusted the backend's string.
 */

export function dashboardPublicPath(token: string): string {
  return `/dashboards/public/${token}`
}

export function embedPublicPath(token: string): string {
  return `/embed/public/${token}`
}

/**
 * The results of one query, authenticated by that query's own API key. This is
 * the URL the API-key dialog hands out to copy, so it goes through the proxy
 * on this origin like every link above. The backend's own host is not an
 * alternative: it is an in-cluster name in a deployment, and the deployed
 * NEXT_PUBLIC_REDASH_URL is a bare build toggle (`1`), not an address.
 */
export function queryResultsApiPath(
  queryId: number,
  apiKey: string,
  filetype: 'json' | 'csv'
): string {
  return `/api/node/queries/${queryId}/results.${filetype}?api_key=${encodeURIComponent(apiKey)}`
}

/**
 * Absolute, for a field somebody copies out of the product and pastes into a
 * mail. Empty origin during SSR, where there is no window and no reader yet;
 * every caller renders client-side and gets the real origin on mount.
 */
export function publicLinkUrl(path: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}${path}`
}

/**
 * The share token of an object Redash reports as shared.
 *
 * `api_key` is the field to use: the dashboards handler sets it and
 * `public_url` together, inside the same branch. The fallback reads the token
 * off the tail of that URL, for the shape where only the URL arrives. It is
 * deliberately the last segment and nothing more clever, because the one thing
 * this must never do is return a plausible-looking wrong token: null renders no
 * link at all, which is honest, while a wrong token renders a live-looking link
 * to somebody else's 404.
 */
export function shareToken(object: {
  api_key?: string | null
  public_url?: string | null
}): string | null {
  if (object.api_key) return object.api_key
  if (!object.public_url) return null
  let path: string
  try {
    // The base only matters for a relative URL; for an absolute one it is
    // ignored. Parsing rather than splitting on '/' because the naive split
    // returns the *host* for `https://redash/`, which is a live-looking wrong
    // token, and this function exists to not do that.
    path = new URL(object.public_url, 'http://link.invalid').pathname
  } catch {
    return null
  }
  const segments = path.split('/').filter(Boolean)
  // Two or more, because Redash's shape is /public/dashboards/<token>: a single
  // segment is a URL with no token in it, and guessing one from a host or a
  // route name is exactly the wrong-but-plausible answer.
  return segments.length > 1 ? segments[segments.length - 1] : null
}
