/**
 * The addresses this product serves to somebody who is not signed in. All are
 * Next routes on this origin: `api/node/[...path]` lets the token paths and the
 * `?api_key=` results paths through without a session.
 *
 * Never build one from Redash's own `public_url`. That is
 * `/public/dashboards/<token>` (segments the other way round) on whatever host
 * Redash was configured with, which in a Kubernetes deployment is the
 * in-cluster service name and resolves for nobody outside the cluster.
 */

export function dashboardPublicPath(token: string): string {
  return `/dashboards/public/${token}`
}

export function embedPublicPath(token: string): string {
  return `/embed/public/${token}`
}

/**
 * The results of one query, authenticated by that query's own API key, through
 * the proxy on this origin. The deployed `NEXT_PUBLIC_REDASH_URL` is a bare
 * build toggle (`1`), not an address, so it is no alternative.
 */
export function queryResultsApiPath(
  queryId: number,
  apiKey: string,
  filetype: 'json' | 'csv'
): string {
  return `/api/node/queries/${queryId}/results.${filetype}?api_key=${encodeURIComponent(apiKey)}`
}

/**
 * Absolute, for a link somebody copies out of the product. The origin is empty
 * under SSR; every caller renders client-side and gets the real one on mount.
 */
export function publicLinkUrl(path: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}${path}`
}

/**
 * The share token of an object Redash reports as shared. `api_key` is the field
 * to use; the fallback reads the last segment of `public_url`, for the shape
 * where only the URL arrives. Returning null (no link) beats returning a
 * plausible-looking wrong token.
 */
export function shareToken(object: {
  api_key?: string | null
  public_url?: string | null
}): string | null {
  if (object.api_key) return object.api_key
  if (!object.public_url) return null
  let path: string
  try {
    // The base is ignored for an absolute URL. Parsed rather than split on '/',
    // because the naive split returns the host for `https://redash/`.
    path = new URL(object.public_url, 'http://link.invalid').pathname
  } catch {
    return null
  }
  const segments = path.split('/').filter(Boolean)
  // Redash's shape is /public/dashboards/<token>, so a single segment is a URL
  // carrying no token at all.
  return segments.length > 1 ? segments[segments.length - 1] : null
}
