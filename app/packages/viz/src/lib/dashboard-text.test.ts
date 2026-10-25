import { describe, expect, it } from 'vitest'
import { isSafeUrl, parseDashboardText, parseInline } from './dashboard-text'

describe('parseDashboardText', () => {
  it('reads headings, paragraphs and lists', () => {
    expect(parseDashboardText('# Closure\nThe bridge is **closed**.\n\n- Detour A\n- Detour *B*')).toEqual([
      { type: 'heading', level: 1, children: [{ type: 'text', value: 'Closure' }] },
      {
        type: 'paragraph',
        children: [
          { type: 'text', value: 'The bridge is ' },
          { type: 'bold', value: 'closed' },
          { type: 'text', value: '.' },
        ],
      },
      {
        type: 'list',
        items: [
          [{ type: 'text', value: 'Detour A' }],
          [
            { type: 'text', value: 'Detour ' },
            { type: 'italic', value: 'B' },
          ],
        ],
      },
    ])
  })

  it('keeps markup as text rather than interpreting it', () => {
    const blocks = parseDashboardText('<script>alert(1)</script><iframe src="https://x.test"></iframe>')

    expect(blocks).toEqual([
      {
        type: 'paragraph',
        children: [{ type: 'text', value: '<script>alert(1)</script><iframe src="https://x.test"></iframe>' }],
      },
    ])
  })

  it('reads a featured announcement: image, linked title, blurb', () => {
    const blocks = parseDashboardText(
      '![Bridge](https://cdn.test/bridge.jpg)\n### [Vincent Thomas Bridge](/projects/vincent-thomas-bridge)\nClosed for repairs.'
    )

    expect(blocks).toEqual([
      { type: 'paragraph', children: [{ type: 'image', alt: 'Bridge', src: 'https://cdn.test/bridge.jpg' }] },
      {
        type: 'heading',
        level: 3,
        children: [{ type: 'link', text: 'Vincent Thomas Bridge', href: '/projects/vincent-thomas-bridge' }],
      },
      { type: 'paragraph', children: [{ type: 'text', value: 'Closed for repairs.' }] },
    ])
  })

  it('reads a linked image', () => {
    expect(parseInline('[![Map](https://cdn.test/m.png)](https://go.test/map)')).toEqual([
      { type: 'image-link', alt: 'Map', src: 'https://cdn.test/m.png', href: 'https://go.test/map' },
    ])
  })
})

describe('link and image safety', () => {
  it.each(['javascript:alert(1)', 'http://plain.test', '//evil.test/x', 'data:image/png;base64,AAA', 'https://a.test/"x', ''])(
    'refuses %s',
    (href) => {
      expect(isSafeUrl(href)).toBe(false)
      expect(parseInline(`[x](${href})`).some((node) => node.type === 'link')).toBe(false)
      expect(parseInline(`![x](${href})`).some((node) => node.type === 'image')).toBe(false)
    }
  )

  it.each(['https://a.test/page', '/traffic/alerts', '/site-assets/static/x.png'])('accepts %s', (href) => {
    expect(isSafeUrl(href)).toBe(true)
  })
})
