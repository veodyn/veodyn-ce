/**
 * Whether auth cookies carry the `Secure` attribute.
 *
 * Off outside production on purpose: local development and the e2e suite both
 * run over plain HTTP, and a browser silently drops a `Secure` cookie on an
 * insecure origin, which would present as "login does nothing" rather than as
 * an error.
 *
 * Any new site that writes `session`, `csrf_token` or `redash_api_key` imports
 * from here. The point of the helper is that the production condition has one
 * home; a hand-written attribute string at a sixth call site is the regression
 * to watch for in review.
 */
export const COOKIE_SECURE = process.env.NODE_ENV === 'production'

/**
 * The same decision as a raw `Set-Cookie` fragment, for the two call sites that
 * must build the header by hand. Empty string when not secure.
 */
export const COOKIE_SECURE_ATTR = COOKIE_SECURE ? '; Secure' : ''
