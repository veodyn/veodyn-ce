import { describe, expect, it } from 'vitest'
import { normalizeHex } from './hex-color'

describe('normalizeHex', () => {
  it('uppercases and keeps a well-formed 6-digit hex, with or without the #', () => {
    expect(normalizeHex('#485ea7')).toBe('#485EA7')
    expect(normalizeHex('485ea7')).toBe('#485EA7')
  })

  it('expands the 3-digit shorthand to 6 digits, with or without the #', () => {
    // The exact case a real browser hands back: Lightning CSS (Tailwind v4's
    // build-time minifier) rewrites #FFFFFF to #fff in the CSS it actually
    // ships, so getComputedStyle('--card') in a built app genuinely returns
    // this 3-digit form, not a hand-authored one.
    expect(normalizeHex('#fff')).toBe('#FFFFFF')
    expect(normalizeHex('fff')).toBe('#FFFFFF')
    expect(normalizeHex('#a3c')).toBe('#AA33CC')
  })

  it('rejects a string that is not a hex color of either length', () => {
    expect(() => normalizeHex('nope')).toThrow(/hex color/)
    expect(() => normalizeHex('#12345')).toThrow(/hex color/)
  })
})
