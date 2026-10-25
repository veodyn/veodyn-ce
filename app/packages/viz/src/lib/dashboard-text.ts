export type TextInline =
  | { type: 'text'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'italic'; value: string }
  | { type: 'link'; text: string; href: string }
  | { type: 'image'; alt: string; src: string }
  | { type: 'image-link'; alt: string; src: string; href: string }

export type TextBlock =
  | { type: 'heading'; level: 1 | 2 | 3; children: TextInline[] }
  | { type: 'paragraph'; children: TextInline[] }
  | { type: 'list'; items: TextInline[][] }

const HEADING = /^(#{1,3})[ \t]+(.*)$/
const LIST_ITEM = /^\s*[-*][ \t]+(.*)$/
const UNSAFE_URL_CHARACTERS = /[\s<>"'`\\]/
const PLAIN_MARK = /^[^[\]*\r\n]+$/
const IMAGE_LINK = /^\[!\[([^\]\r\n]*)\]\(([^)\s]+)\)\]\(([^)\s]+)\)/
const IMAGE = /^!\[([^\]\r\n]*)\]\(([^)\s]+)\)/
const LINK = /^\[([^\]\r\n]+)\]\(([^)\s]+)\)/

export function isSafeUrl(href: string): boolean {
  if (href === '' || UNSAFE_URL_CHARACTERS.test(href)) return false
  if (href.startsWith('/')) return !href.startsWith('//')
  try {
    return new URL(href).protocol === 'https:'
  } catch {
    return false
  }
}

function appendText(nodes: TextInline[], value: string): void {
  if (value === '') return
  const previous = nodes.at(-1)
  if (previous?.type === 'text') previous.value += value
  else nodes.push({ type: 'text', value })
}

function readMark(rest: string, marker: string): string | null {
  if (!rest.startsWith(marker)) return null
  const close = rest.indexOf(marker, marker.length)
  if (close === -1) return null
  const value = rest.slice(marker.length, close)
  return PLAIN_MARK.test(value) ? value : null
}

export function parseInline(source: string): TextInline[] {
  const nodes: TextInline[] = []
  let cursor = 0
  while (cursor < source.length) {
    const rest = source.slice(cursor)
    const imageLink = IMAGE_LINK.exec(rest)
    if (imageLink) {
      const [match, alt, src, href] = imageLink
      if (isSafeUrl(src) && isSafeUrl(href)) nodes.push({ type: 'image-link', alt, src, href })
      else appendText(nodes, match)
      cursor += match.length
      continue
    }
    const image = IMAGE.exec(rest)
    if (image) {
      const [match, alt, src] = image
      if (isSafeUrl(src)) nodes.push({ type: 'image', alt, src })
      else appendText(nodes, match)
      cursor += match.length
      continue
    }
    const link = LINK.exec(rest)
    if (link) {
      const [match, text, href] = link
      if (PLAIN_MARK.test(text) && isSafeUrl(href)) nodes.push({ type: 'link', text, href })
      else appendText(nodes, match)
      cursor += match.length
      continue
    }
    const bold = readMark(rest, '**')
    if (bold !== null) {
      nodes.push({ type: 'bold', value: bold })
      cursor += bold.length + 4
      continue
    }
    const italic = rest.startsWith('**') ? null : readMark(rest, '*')
    if (italic !== null) {
      nodes.push({ type: 'italic', value: italic })
      cursor += italic.length + 2
      continue
    }
    const next = rest.slice(1).search(/[[!*]/)
    const length = next === -1 ? rest.length : next + 1
    appendText(nodes, rest.slice(0, length))
    cursor += length
  }
  return nodes
}

function paragraphOrList(lines: string[]): TextBlock[] {
  const blocks: TextBlock[] = []
  let paragraph: string[] = []
  let items: string[] = []
  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ type: 'paragraph', children: parseInline(paragraph.join(' ')) })
    paragraph = []
  }
  const flushList = () => {
    if (items.length > 0) blocks.push({ type: 'list', items: items.map(parseInline) })
    items = []
  }
  for (const line of lines) {
    const item = LIST_ITEM.exec(line)
    if (item) {
      flushParagraph()
      items.push(item[1])
    } else {
      flushList()
      paragraph.push(line.trim())
    }
  }
  flushParagraph()
  flushList()
  return blocks
}

export function parseDashboardText(source: string): TextBlock[] {
  const blocks: TextBlock[] = []
  let pending: string[] = []
  const flush = () => {
    blocks.push(...paragraphOrList(pending))
    pending = []
  }
  for (const line of source.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = HEADING.exec(line)
    if (heading) {
      flush()
      blocks.push({ type: 'heading', level: heading[1].length as 1 | 2 | 3, children: parseInline(heading[2].trim()) })
    } else if (line.trim() === '') {
      flush()
    } else {
      pending.push(line)
    }
  }
  flush()
  return blocks
}
