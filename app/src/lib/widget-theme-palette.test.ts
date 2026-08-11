import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DARK_TOKENS,
  LIGHT_TOKENS,
  THEME_TOKEN_NAMES,
  themeTokens,
} from './widget-theme-palette'

// These values are a copy of the stylesheet, which is a thing that rots
// silently: a designer changes --card in tokens.css, every themed surface in
// the app follows, and pinned widgets alone keep painting last month's colour.
// Nothing else in the suite would notice, so this re-reads the source of truth
// and compares.
const css = readFileSync(join(__dirname, '..', 'app', 'tokens.css'), 'utf8')

function block(selector: string): Record<string, string> {
  const match = css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))
  if (!match) throw new Error(`[widget-theme-palette] tokens.css has no ${selector} block`)
  return Object.fromEntries(
    [...match[1].matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()])
  )
}

const root = block(':root')
const dark = block('\\.dark')

describe('the palette tracks tokens.css', () => {
  // The set is defined as "what .dark overrides". A token added to .dark and
  // not here is one colour that refuses to flip inside a pinned panel.
  it('covers exactly the tokens a theme switch changes', () => {
    expect([...THEME_TOKEN_NAMES].sort()).toEqual(Object.keys(dark).sort())
  })

  it.each(Object.keys(dark).sort())('dark %s matches the stylesheet', (name) => {
    expect(DARK_TOKENS[name]).toBe(dark[name])
  })

  it.each(Object.keys(dark).sort())('light %s matches the stylesheet', (name) => {
    expect(LIGHT_TOKENS[name]).toBe(root[name])
  })

  // Guards the two assertions above: if the palettes were ever the same object
  // or the same values, every check would still pass and pinning would do
  // nothing visible.
  it('is actually two different palettes', () => {
    expect(LIGHT_TOKENS['--background']).not.toBe(DARK_TOKENS['--background'])
  })
})

describe('themeTokens', () => {
  it('returns the dark palette for dark', () => {
    expect(themeTokens('dark')).toBe(DARK_TOKENS)
  })

  it('returns the light palette for light', () => {
    expect(themeTokens('light')).toBe(LIGHT_TOKENS)
  })

  // Applied straight onto a style prop, so every key has to be a custom
  // property. A stray plain key would be a silently ignored CSS declaration.
  it('only ever yields custom properties', () => {
    for (const name of Object.keys({ ...LIGHT_TOKENS, ...DARK_TOKENS })) {
      expect(name.startsWith('--')).toBe(true)
    }
  })
})
