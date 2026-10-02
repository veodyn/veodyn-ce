export interface HelpLinkView {
  callId: string
  page: string
  pageTitle: string
  anchor: string | null
  sectionTitle: string | null
  reason: string
}

/**
 * The docs site is built with `trailingSlash: true`, so a page lives at
 * `…/features/queries/` and the bare path only gets there through a redirect
 * that drops the fragment. The host comes from `brand.docs_url`, which each
 * deployment already sets for the sidebar's Documentation row.
 */
export function helpLinkHref(docsUrl: string | null, page: string, anchor: string | null): string | null {
  if (!docsUrl) return null
  const base = docsUrl.replace(/\/+$/, '')
  const path = page ? `${base}/${page}/` : `${base}/`
  return anchor ? `${path}#${anchor}` : path
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function optional(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

/** A help link rebuilt from a stored `link_help` call and its tool result. */
export function storedHelpLink(
  callId: string,
  input: Record<string, unknown>,
  content: Record<string, unknown>
): HelpLinkView | null {
  if (content.linked !== true || typeof content.page !== 'string') return null
  // A section title without an anchor would render a row pointing nowhere, so
  // the anchor decides whether there is a section at all.
  const anchor = optional(content.section)
  return {
    callId,
    page: content.page,
    pageTitle: text(content.pageTitle),
    anchor,
    sectionTitle: anchor ? optional(content.sectionTitle) : null,
    reason: text(input.reason),
  }
}
