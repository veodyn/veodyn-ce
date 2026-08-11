/**
 * Rewrite a Redash-origin invite/reset link to point at this app's origin.
 *
 * Redash generates links like: http://redash:5001/invite/TOKEN
 * We serve the same pages at:  http://app:3000/invite/TOKEN
 *
 * Extracts the path (/invite/TOKEN or /reset/TOKEN) and prepends
 * window.location.origin.
 */
export function toLocalLink(redashLink: string): string {
  try {
    const url = new URL(redashLink)
    // Only rewrite known token paths to avoid accidentally rewriting other URLs
    if (url.pathname.startsWith('/invite/') || url.pathname.startsWith('/reset/')) {
      return window.location.origin + url.pathname
    }
  } catch {
    // Fall through to return original
  }
  return redashLink
}
