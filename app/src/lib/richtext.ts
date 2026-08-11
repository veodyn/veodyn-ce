export type RichInline =
  | { type: 'text'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'italic'; value: string }
  | { type: 'link'; text: string; href: string }
  | { type: 'ref'; token: string }

export type RichNode =
  | { type: 'paragraph'; children: RichInline[] }
  | { type: 'list'; items: RichInline[][] }

const REF_CANDIDATE = /\{\{[^{}\r\n]*\}\}/g
const VALID_REF =
  /^\{\{(?:query:\d+\s*·\s*column:\s*[^{}\r\n]*[^\s{}\r\n]|kpi:[^\s{}]+)\}\}$/

function isValidRefToken(token: string): boolean {
  return VALID_REF.test(token)
}

export function extractRefTokens(src: string): string[] {
  return Array.from(src.matchAll(REF_CANDIDATE), (match) => match[0]).filter(isValidRefToken)
}

/**
 * What an unresolved reference reads as in the rendered document.
 *
 * A bare "-" was rejected first, because "closed the week at -" looks like a
 * finished sentence with a broken number rather than a metric awaiting its
 * snapshot. `[not computed]` fixed that and introduced a worse problem: it is a
 * bracketed code token sitting in the prose of a board-facing document, and it
 * reads as a template that failed to render.
 *
 * A quiet word does both jobs. The document still reads as unfinished, which it
 * is, without looking broken. The renderer styles it and hangs the reference off
 * a tooltip, so the token itself stays out of the sentence.
 */
export const UNRESOLVED_REF_PLACEHOLDER = 'pending'

export interface ResolvedRef {
  value: string
  resolved: boolean
}

/** The value with whether it is real, for renderers that style the two apart. */
export function resolveRef(token: string, refs: Record<string, string>): ResolvedRef {
  const value = refs[token]
  return value == null || value === ''
    ? { value: UNRESOLVED_REF_PLACEHOLDER, resolved: false }
    : { value, resolved: true }
}

export function resolveRefToken(token: string, refs: Record<string, string>): string {
  return resolveRef(token, refs).value
}

function appendText(nodes: RichInline[], value: string): void {
  if (value === '') return

  const previous = nodes.at(-1)
  if (previous?.type === 'text') {
    previous.value += value
    return
  }

  nodes.push({ type: 'text', value })
}

function isPlainMarkValue(value: string): boolean {
  return value !== '' && !/[\[\]{}*\r\n]/.test(value)
}

function isSafeLink(href: string): boolean {
  if (/\s|[<>"']/.test(href)) return false

  try {
    const url = new URL(href)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

// A forward-only marker search that remembers where it last found each needle.
// The naive version rescanned the whole remaining paragraph for every character
// it stepped over, so a narrative of unmatched brackets was quadratic and could
// stall both the SSR pass and the client view on author input alone. The cursor
// only ever moves forward, so a hit at or after the requested position is still
// the first hit, and a miss stays a miss: each needle therefore scans every
// character at most once across the whole parse.
function markerScanner(segment: string): (needle: string, from: number) => number {
  const found = new Map<string, number>()
  return (needle, from) => {
    const cached = found.get(needle)
    if (cached !== undefined && (cached === -1 || cached >= from)) return cached
    const next = segment.indexOf(needle, from)
    found.set(needle, next)
    return next
  }
}

/**
 * One line's inline marks, with no block-level reading of it at all.
 *
 * Exported for callers that already know their string is a single line of
 * prose (a heading, for instance). Going through parseRichText instead makes
 * the block rules apply: a heading reading "- secret" comes back as a LIST,
 * and a caller that only accepts a paragraph then renders an empty heading
 * and loses the author's text.
 */
export function parseInlineText(segment: string): RichInline[] {
  return parseInline(segment)
}

function parseInline(segment: string): RichInline[] {
  const nodes: RichInline[] = []
  const find = markerScanner(segment)
  let cursor = 0

  while (cursor < segment.length) {
    if (segment.startsWith('{{', cursor)) {
      const close = find('}}', cursor + 2)
      if (close === -1) {
        appendText(nodes, segment.slice(cursor))
        break
      }

      const token = segment.slice(cursor, close + 2)
      if (isValidRefToken(token)) {
        nodes.push({ type: 'ref', token })
      } else {
        appendText(nodes, token)
      }
      cursor = close + 2
      continue
    }

    if (segment[cursor] === '[') {
      const labelEnd = find('](', cursor + 1)
      if (labelEnd === -1) {
        appendText(nodes, '[')
        cursor += 1
        continue
      }

      const hrefEnd = find(')', labelEnd + 2)
      if (hrefEnd === -1) {
        appendText(nodes, segment.slice(cursor))
        break
      }

      const candidate = segment.slice(cursor, hrefEnd + 1)
      const text = segment.slice(cursor + 1, labelEnd)
      const href = segment.slice(labelEnd + 2, hrefEnd)
      if (isPlainMarkValue(text) && isSafeLink(href)) {
        nodes.push({ type: 'link', text, href })
      } else {
        appendText(nodes, candidate)
      }
      cursor = hrefEnd + 1
      continue
    }

    if (segment.startsWith('**', cursor)) {
      const close = find('**', cursor + 2)
      if (close === -1) {
        appendText(nodes, segment.slice(cursor))
        break
      }

      const value = segment.slice(cursor + 2, close)
      if (!isPlainMarkValue(value)) {
        appendText(nodes, segment.slice(cursor))
        break
      }

      nodes.push({ type: 'bold', value })
      cursor = close + 2
      continue
    }

    if (segment[cursor] === '*') {
      const close = find('*', cursor + 1)
      if (close === -1) {
        appendText(nodes, segment.slice(cursor))
        break
      }

      const value = segment.slice(cursor + 1, close)
      const closingOverlapsBold = segment[close + 1] === '*'
      if (closingOverlapsBold || !isPlainMarkValue(value)) {
        appendText(nodes, segment.slice(cursor))
        break
      }

      nodes.push({ type: 'italic', value })
      cursor = close + 1
      continue
    }

    const nextRef = find('{{', cursor + 1)
    const nextLink = find('[', cursor + 1)
    const nextMark = find('*', cursor + 1)
    const candidates = [nextRef, nextLink, nextMark].filter((index) => index !== -1)
    const nextSyntax = candidates.length === 0 ? segment.length : Math.min(...candidates)
    appendText(nodes, segment.slice(cursor, nextSyntax))
    cursor = nextSyntax
  }

  return nodes
}

export function parseRichText(src: string): RichNode[] {
  return src.split(/\n\s*\n/).map((block) => {
    const lines = block.split('\n')
    const isList = lines.length > 0 && lines.every((line) => line.trimStart().startsWith('- '))

    if (isList) {
      return {
        type: 'list',
        items: lines.map((line) => parseInline(line.trimStart().slice(2))),
      }
    }

    return {
      type: 'paragraph',
      children: parseInline(block.replace(/\n/g, ' ')),
    }
  })
}
