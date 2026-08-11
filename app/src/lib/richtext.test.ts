import { describe, expect, it } from 'vitest'
import {
  extractRefTokens,
  parseRichText,
  resolveRefToken,
  type RichInline,
  type RichNode,
} from './richtext'

function paragraphChildren(nodes: RichNode[]): RichInline[] {
  const [node] = nodes
  expect(node?.type).toBe('paragraph')
  if (!node || node.type !== 'paragraph') {
    throw new Error('Expected one paragraph')
  }
  return node.children
}

function inlineText(nodes: RichNode[]): string {
  return paragraphChildren(nodes)
    .map((node) => {
      if (node.type === 'ref') return node.token
      if (node.type === 'link') return `[${node.text}](${node.href})`
      return node.value
    })
    .join('')
}

describe('extractRefTokens', () => {
  it('finds all valid reference tokens', () => {
    expect(extractRefTokens('riders {{query:1 · column:riders}} and {{kpi:otp}}')).toEqual([
      '{{query:1 · column:riders}}',
      '{{kpi:otp}}',
    ])
  })

  it('ignores malformed reference tokens', () => {
    expect(
      extractRefTokens(
        '{{query:x · column:riders}} {{query:1 column:riders}} {{kpi:}} {{not-a-ref}}'
      )
    ).toEqual([])
  })
})

describe('resolveRefToken', () => {
  it('returns the frozen scalar from refs, or a visible placeholder when absent', () => {
    expect(resolveRefToken('{{kpi:otp}}', { '{{kpi:otp}}': '82%' })).toBe('82%')
    expect(resolveRefToken('{{kpi:otp}}', {})).toBe('pending')
    expect(resolveRefToken('{{kpi:otp}}', { '{{kpi:otp}}': '' })).toBe('pending')
  })
})

describe('parseRichText', () => {
  it('splits paragraphs and parses bold, italic, link, and ref inline nodes', () => {
    const children = paragraphChildren(
      parseRichText('Hello **bold** and *em* and [x](https://a.test) and {{kpi:otp}}')
    )
    const kinds = children.map((child) => child.type)

    expect(kinds).toContain('bold')
    expect(kinds).toContain('italic')
    expect(kinds).toContain('link')
    expect(kinds).toContain('ref')
  })

  it('splits blank-line separated paragraphs', () => {
    expect(parseRichText('one\n\ntwo')).toHaveLength(2)
  })

  it('parses a list run into a list with items', () => {
    const [node] = parseRichText('- one\n- two')

    expect(node?.type).toBe('list')
    if (!node || node.type !== 'list') {
      throw new Error('Expected one list')
    }
    expect(node.items).toHaveLength(2)
  })

  it('preserves raw HTML as literal text', () => {
    const source = 'a <script>alert("x")</script> b'
    const nodes = parseRichText(source)

    expect(inlineText(nodes)).toBe(source)
    expect(nodes.every((node) => node.type !== ('html' as RichNode['type']))).toBe(true)
  })

  it('preserves a javascript URL as literal text', () => {
    const source = '[bad](javascript:alert(1))'
    const children = paragraphChildren(parseRichText(source))

    expect(children.every((node) => node.type !== 'link')).toBe(true)
    expect(inlineText(parseRichText(source))).toBe(source)
  })

  it('preserves unclosed markers as literal text', () => {
    for (const source of ['**open', '*open', '[open](https://a.test', '{{kpi:otp']) {
      expect(paragraphChildren(parseRichText(source))).toEqual([{ type: 'text', value: source }])
    }
  })

  it('preserves nested and overlapping emphasis markers as literal text', () => {
    for (const source of ['**bold *nested***', '**bold* overlaps**']) {
      expect(paragraphChildren(parseRichText(source))).toEqual([{ type: 'text', value: source }])
    }
  })

  it('preserves malformed reference tokens as literal text', () => {
    for (const source of [
      '{{query:x · column:riders}}',
      '{{query:1 column:riders}}',
      '{{kpi:}}',
      '{{kpi:{{kpi:otp}}}}',
    ]) {
      expect(paragraphChildren(parseRichText(source))).toEqual([{ type: 'text', value: source }])
    }
  })
})

// An author's narrative is untrusted input: it is parsed on the server for the
// SSR pass and again in the browser. A scanner that rescans the remainder of
// the paragraph for every character turns a wall of unmatched brackets into a
// denial of service on both.
//
// The budget is a complexity guard, not a performance target, and it is set
// from what the two implementations actually cost rather than from what a fast
// machine happens to manage. A linear parse of this input measures 9ms on a
// development machine; the CI runner measured 460ms for the same work and
// failed a 400ms bound that its own comment claimed was loose enough for a slow
// machine. A quadratic scanner, meanwhile, is 400,000 times the work: minutes,
// not milliseconds. So the bound only has to sit between those, and it is put
// far enough above the slow measurement that a loaded runner cannot reach it.
describe('parseRichText on oversized malformed input', () => {
  const BUDGET_MS = 5_000
  const SIZE = 400_000

  it('parses a wall of unmatched opening brackets in linear time', () => {
    const source = '['.repeat(SIZE)

    const started = performance.now()
    const nodes = parseRichText(source)
    const elapsed = performance.now() - started

    expect(inlineText(nodes)).toHaveLength(SIZE)
    expect(elapsed).toBeLessThan(BUDGET_MS)
  })

  it('stays linear when unmatched brackets are interleaved with plain text', () => {
    const source = 'a['.repeat(SIZE / 2)

    const started = performance.now()
    const nodes = parseRichText(source)
    const elapsed = performance.now() - started

    expect(inlineText(nodes)).toHaveLength(SIZE)
    expect(elapsed).toBeLessThan(BUDGET_MS)
  })

  it('still finds the syntax that follows an unmatched bracket', () => {
    const nodes = paragraphChildren(parseRichText('[unclosed and **bold** after it'))

    expect(nodes).toContainEqual({ type: 'bold', value: 'bold' })
  })
})
