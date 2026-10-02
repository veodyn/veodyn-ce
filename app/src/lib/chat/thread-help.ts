export interface HelpLinkView {
  callId: string
  page: string
  pageTitle: string
  anchor: string | null
  sectionTitle: string | null
  reason: string
}

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

export function storedHelpLink(
  callId: string,
  input: Record<string, unknown>,
  content: Record<string, unknown>
): HelpLinkView | null {
  if (content.linked !== true || typeof content.page !== 'string') return null
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
