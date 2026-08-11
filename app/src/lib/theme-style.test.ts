import { describe, expect, it } from 'vitest'
import { themeStyle } from '@/lib/theme-style'
import { CHART_PALETTE_SIZE, contrast, oklch } from '@/lib/chart-palette'
import { getChartPalette } from '@/lib/chart-colors'
import {
  CHART_SURFACE_DARK,
  DEFAULT_ACCENT_DARK,
  DEFAULT_PALETTE_DARK,
  NEUTRAL_CONFIG,
} from '@/lib/config-schema'
import { required } from '@/lib/required'

// A short, hand-picked tenant palette. Deliberately not the default one, so
// these tests exercise the derive-from-tenant path, not the built-in one.
// The two hexes sit outside the dark lightness band (0.48-0.67 OKLCH L), one
// above and one below, so deriveDarkColumn is guaranteed to move both: a
// tenant color that happens to already sit inside the band would derive to
// itself, which would make a "differs from light" assertion flaky.
const tenantConfig = {
  theme: {
    ...NEUTRAL_CONFIG.theme,
    accent: '#475569',
    chart_palette: ['#A9C8FF', '#0F1D3C'],
  },
}

describe('themeStyle', () => {
  it('emits a :root scope and a .dark scope', () => {
    const css = themeStyle(tenantConfig)
    expect(css).toContain(':root {')
    expect(css).toContain('.dark {')
  })

  it('emits .dark after :root, so source order lets it win the tied specificity', () => {
    const css = themeStyle(tenantConfig)
    expect(css.indexOf(':root {')).toBeLessThan(css.indexOf('.dark {'))
  })

  it('fills 8 light slots from the tenant palette, cycling a short one', () => {
    const css = themeStyle(tenantConfig)
    const root = css.slice(css.indexOf(':root {'), css.indexOf('.dark {'))
    expect(root).toContain('--chart-1: #A9C8FF;')
    expect(root).toContain('--chart-2: #0F1D3C;')
    // 2-entry palette cycles: slot 3 repeats slot 1.
    expect(root).toContain('--chart-3: #A9C8FF;')
    expect(root).toContain('--chart-8:')
  })

  it('derives distinct dark slots rather than repeating the light ones', () => {
    const css = themeStyle(tenantConfig)
    const dark = css.slice(css.indexOf('.dark {'))
    expect(dark).toContain('--chart-1:')
    expect(dark).not.toContain('--chart-1: #A9C8FF;')
  })

  it('no longer publishes the dead --chart-count var', () => {
    expect(themeStyle(tenantConfig)).not.toContain('--chart-count')
  })

  // This used to assert the opposite ("keeps the accent on the light scope
  // only", --primary emitted exactly once), which encoded a bug as intent. This
  // block is emitted after globals.css and `:root` ties `.dark` on specificity,
  // so a light-only accent silently overrode the stylesheet's dark --primary:
  // the dark scope painted #475569 at 2.55:1 on its own surface, against the
  // 7.96:1 the hand-picked #7FA9E0 was chosen for. Invisible until the theme
  // toggle made the dark scope reachable outside /wall and /present.
  it('emits the accent for both scopes, so the dark scope is not left with the light accent', () => {
    const css = themeStyle(tenantConfig)
    const root = css.slice(css.indexOf(':root {'), css.indexOf('.dark {'))
    const dark = css.slice(css.indexOf('.dark {'))

    expect(root).toContain('--primary: #475569;')
    expect(root).toContain('--ring: #475569;')
    expect(dark).toContain('--primary:')
    expect(dark).toContain('--ring:')
    expect(dark).not.toContain('--primary: #475569;')
  })

  it('gives an unmodified build the hand-picked dark accent rather than a derived one', () => {
    // tenantConfig keeps the default accent, so this is the selected-beats-
    // derived path, matching how the default palette is treated.
    const dark = themeStyle(tenantConfig).slice(themeStyle(tenantConfig).indexOf('.dark {'))
    expect(dark).toContain(`--primary: ${DEFAULT_ACCENT_DARK};`)
  })

  it('re-steps a tenant accent for the dark surface instead of reusing it flat', () => {
    const branded = {
      theme: { ...NEUTRAL_CONFIG.theme, accent: '#DC2626' },
    }
    const css = themeStyle(branded)
    const dark = css.slice(css.indexOf('.dark {'))

    const emitted = /--primary: (#[0-9A-Fa-f]{6});/.exec(dark)?.[1]
    expect(emitted).toBeDefined()
    const accent = required(emitted, 'dark accent')

    // Readable on the dark card, which the raw brand red is not (3.96:1).
    expect(contrast(accent, CHART_SURFACE_DARK)).toBeGreaterThanOrEqual(4.5)
    // ...and still recognisably the brand colour, not the grey a
    // chroma-first search collapses a saturated red into.
    const [, chroma] = oklch(accent)
    expect(chroma).toBeGreaterThan(0.15)
  })

  // Finding 2: the emitter, the validator, and the fixed 8-slot renderer must
  // agree on what actually ships. Before this fix, a palette longer than 8
  // emitted --chart-9 and beyond, which chart-colors.ts's fixed PALETTE_SIZE
  // never reads.
  it('caps emission at CHART_PALETTE_SIZE (8) rather than emitting a slot nothing reads', () => {
    const tooLong = {
      theme: {
        ...NEUTRAL_CONFIG.theme,
        chart_palette: ['#485EA7', '#2B7E4E', '#A37AC7', '#3570A2', '#89435E', '#BF8A32', '#1D9999', '#B25630', '#111111', '#222222'],
      },
    }
    const css = themeStyle(tooLong)
    expect(css).toContain('--chart-8:')
    expect(css).not.toContain('--chart-9')
    expect(css).not.toContain('--chart-10')
  })

  // The renderer's own slot count (chart-colors.ts's PALETTE_SIZE, which this
  // phase treats as fixed) and this emitter's slot count must stay in sync,
  // or the validator and the emitter can agree with each other while
  // disagreeing with what the renderer actually reads.
  it('emits exactly as many slots as the renderer resolves', () => {
    expect(CHART_PALETTE_SIZE).toBe(getChartPalette().length)
  })

  it('uses the hand-picked default dark column, not a derived one, when the tenant has not overridden the palette', () => {
    const css = themeStyle(NEUTRAL_CONFIG)
    const dark = css.slice(css.indexOf('.dark {'))
    DEFAULT_PALETTE_DARK.forEach((hex, i) => {
      expect(dark).toContain(`--chart-${i + 1}: ${hex};`)
    })
  })

  it('still recognizes the default palette pasted in lowercase, so it gets the hand-picked dark column instead of an unvalidated derived one', () => {
    const lowercaseDefaultConfig = {
      theme: {
        ...NEUTRAL_CONFIG.theme,
        chart_palette: NEUTRAL_CONFIG.theme.chart_palette.map((hex) => hex.toLowerCase()),
      },
    }
    const css = themeStyle(lowercaseDefaultConfig)
    const dark = css.slice(css.indexOf('.dark {'))
    DEFAULT_PALETTE_DARK.forEach((hex, i) => {
      expect(dark).toContain(`--chart-${i + 1}: ${hex};`)
    })
  })
})
