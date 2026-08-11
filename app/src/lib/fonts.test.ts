import { describe, expect, it } from 'vitest'
import { resolveFontFamilyVars, DEFAULT_FONT_FAMILIES } from '@/lib/fonts'

const registry = {
  Newsreader: { variable: '--font-newsreader' },
  Geist: { variable: '--font-geist' },
  'Geist Mono': { variable: '--font-geist-mono' },
}

describe('resolveFontFamilyVars', () => {
  it('maps each configured role to its registered font variable', () => {
    expect(
      resolveFontFamilyVars(
        { display: 'Newsreader', ui: 'Geist', mono: 'Geist Mono' },
        registry
      )
    ).toEqual({
      '--font-display-family': 'var(--font-newsreader)',
      '--font-sans-family': 'var(--font-geist)',
      '--font-mono-family': 'var(--font-geist-mono)',
    })
  })

  it('falls back to the default family when a configured name is not allow-listed', () => {
    const vars = resolveFontFamilyVars(
      { display: 'NotInstalled', ui: 'Geist', mono: 'Geist Mono' },
      registry
    )
    expect(vars['--font-display-family']).toBe('var(--font-newsreader)')
    expect(DEFAULT_FONT_FAMILIES.display).toBe('Newsreader')
  })
})
