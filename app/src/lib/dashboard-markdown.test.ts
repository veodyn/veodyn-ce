import { describe, expect, it } from 'vitest'
import { missingHeadingSpace, parseTextbox } from './dashboard-markdown'

describe('parseTextbox', () => {
  it('reads a heading at each of the three levels', () => {
    const nodes = parseTextbox('# One\n\n## Two\n\n### Three')

    expect(nodes.map((node) => (node.type === 'heading' ? node.level : node.type))).toEqual([1, 2, 3])
  })

  it('leaves a hash with no space after it as prose', () => {
    // CommonMark: "##Text" is not a heading. This is the case the report came
    // from, and reading it as a heading would make this renderer disagree with
    // every other markdown tool the author has ever used.
    const nodes = parseTextbox('##Text box header')

    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.type).toBe('paragraph')
  })

  it('does not read a fourth level as a heading', () => {
    const nodes = parseTextbox('#### Four')

    expect(nodes[0]?.type).toBe('paragraph')
  })

  it('keeps a paragraph next to a heading without swallowing it', () => {
    const nodes = parseTextbox('# Title\nSome prose.\n\nMore prose.')

    expect(nodes.map((node) => node.type)).toEqual(['heading', 'paragraph', 'paragraph'])
  })

  it('reads a bullet list', () => {
    const nodes = parseTextbox('- one\n- two')

    expect(nodes[0]?.type).toBe('list')
  })

  it('marks up bold and italic inside a heading', () => {
    const nodes = parseTextbox('## A **bold** word')
    const heading = nodes[0]

    expect(heading?.type).toBe('heading')
    if (heading?.type !== 'heading') return
    expect(heading.children.some((child) => child.type === 'bold' && child.value === 'bold')).toBe(true)
  })

  it('keeps a dangerous link as text rather than a link', () => {
    // Inherited from richtext's isSafeLink, and asserted here too: this
    // module is a second entry point into that parser, and a regression there
    // would land on a dashboard everyone in the org can open.
    const nodes = parseTextbox('[click](javascript:alert(1))')
    const paragraph = nodes[0]

    expect(paragraph?.type).toBe('paragraph')
    if (paragraph?.type !== 'paragraph') return
    expect(paragraph.children.every((child) => child.type !== 'link')).toBe(true)
  })

  it('carries raw HTML through as text, never as markup', () => {
    // The whole reason this module exists. The previous renderer pushed the
    // source into dangerouslySetInnerHTML, so this string executed for every
    // viewer of the dashboard. Parsed to nodes, there is nothing to execute:
    // the text is text.
    const nodes = parseTextbox('<img src=x onerror=alert(1)>')
    const paragraph = nodes[0]

    expect(paragraph?.type).toBe('paragraph')
    if (paragraph?.type !== 'paragraph') return
    expect(paragraph.children).toEqual([{ type: 'text', value: '<img src=x onerror=alert(1)>' }])
  })

  it('has nothing to render for empty source', () => {
    expect(parseTextbox('')).toEqual([])
    expect(parseTextbox('   \n  ')).toEqual([])
  })
})

describe('a heading whose text looks like a block', () => {
  // Found in review. A heading is one line, but its text can still read as a
  // block to a block parser: "- secret" is a LIST to parseRichText, and the
  // heading then rendered with no children at all. The author saw their words
  // in the editor and no reader ever got them.
  it('keeps text that starts with a list marker', () => {
    const nodes = parseTextbox('# - secret')
    const heading = nodes[0]

    expect(heading?.type).toBe('heading')
    if (heading?.type !== 'heading') return
    expect(heading.children).not.toEqual([])
    expect(heading.children.map((child) => (child.type === 'text' ? child.value : '')).join('')).toContain(
      'secret'
    )
  })

  it('still marks up a heading that is only a link', () => {
    const nodes = parseTextbox('## [docs](https://example.com)')
    const heading = nodes[0]

    expect(heading?.type).toBe('heading')
    if (heading?.type !== 'heading') return
    expect(heading.children).toEqual([
      { type: 'link', text: 'docs', href: 'https://example.com' },
    ])
  })
})

describe('nothing the author wrote disappears', () => {
  // The silent failure mode: a block parser that loses a line saves text the
  // author can see in the editor and no reader ever gets.
  it.each([
    ['a heading between list items', '- one\n## Middle\n- two'],
    ['a heading with no blank line around it', 'before\n# Title\nafter'],
    ['consecutive headings', '# One\n## Two\n### Three'],
    ['trailing prose after a heading', '# Title\n\nbody\n\n## Next\n\nmore'],
    ['a heading as the very last line', 'body\n# Last'],
  ])('keeps every word: %s', (_label, source) => {
    const rendered = parseTextbox(source)
      .flatMap((node) =>
        node.type === 'list'
          ? node.items.flat()
          : node.type === 'heading'
            ? node.children
            : node.children
      )
      .map((inline) => (inline.type === 'text' ? inline.value : JSON.stringify(inline)))
      .join(' ')

    for (const word of source.split(/[\s#-]+/).filter(Boolean)) {
      expect(rendered, word).toContain(word)
    }
  })
})

describe('what a text box refuses to turn into a link', () => {
  // A text box is authored by one person and rendered for everyone with access
  // to the dashboard, so the href gate is the security boundary. It lives in
  // richtext's isSafeLink; these run real attack strings through THIS
  // entry point, because a regression there would land here.
  it.each([
    ['javascript:alert(1)', 'the plain scheme'],
    ['JAVASCRIPT:alert(1)', 'an uppercased scheme'],
    ['JaVaScRiPt:alert(1)', 'a mixed-case scheme'],
    ['data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==', 'a data URL'],
    ['vbscript:msgbox(1)', 'vbscript'],
    ['//evil.example.com', 'a protocol-relative host'],
    ['%6aavascript:alert(1)', 'a percent-encoded scheme'],
    ['file:///etc/passwd', 'a local file'],
  ])('refuses %s (%s)', (href) => {
    const nodes = parseTextbox(`[click](${href})`)
    const paragraph = nodes[0]

    expect(paragraph?.type).toBe('paragraph')
    if (paragraph?.type !== 'paragraph') return
    expect(paragraph.children.every((child) => child.type !== 'link')).toBe(true)
  })

  it.each([
    ['java\tscript:alert(1)', 'a tab inside the scheme'],
    ['java\nscript:alert(1)', 'a newline inside the scheme'],
  ])('refuses %s (%s)', (href) => {
    const nodes = parseTextbox(`[click](${href})`)

    for (const node of nodes) {
      if (node.type !== 'paragraph') continue
      expect(node.children.every((child) => child.type !== 'link')).toBe(true)
    }
  })

  it('still allows an ordinary https link', () => {
    const nodes = parseTextbox('[runbook](https://example.com/a?b=1#c)')
    const paragraph = nodes[0]

    expect(paragraph?.type).toBe('paragraph')
    if (paragraph?.type !== 'paragraph') return
    expect(paragraph.children).toContainEqual({
      type: 'link',
      text: 'runbook',
      href: 'https://example.com/a?b=1#c',
    })
  })
})

describe('line endings', () => {
  it('reads a heading written with CRLF', () => {
    // A paste from Windows, or from a file with CRLF endings. Splitting on
    // '\n' alone leaves a '\r' on every line, and `.` matches it, so the
    // carriage return rode along inside the heading text.
    const nodes = parseTextbox('## Title\r\n\r\nBody text.')
    const heading = nodes[0]

    expect(heading?.type).toBe('heading')
    if (heading?.type !== 'heading') return
    expect(heading.children).toEqual([{ type: 'text', value: 'Title' }])
  })
})

describe('missingHeadingSpace', () => {
  it('spots the hash-with-no-space the author actually typed', () => {
    expect(missingHeadingSpace('##Text box header')).toBe(true)
  })

  it('says nothing about a well-formed heading', () => {
    expect(missingHeadingSpace('## Text box header')).toBe(false)
  })

  it('says nothing about a hash that is not at the start of a line', () => {
    expect(missingHeadingSpace('issue #42 is fixed')).toBe(false)
  })

  it('says nothing about prose with no hash at all', () => {
    expect(missingHeadingSpace('Just some text')).toBe(false)
  })
})
