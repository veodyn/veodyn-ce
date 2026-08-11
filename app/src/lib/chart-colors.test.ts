import { afterEach, describe, expect, it, vi } from 'vitest'
import { contrast, hexToOklab, oklabToHex } from '@/lib/chart-palette'
import {
  getChartPalette,
  getSequentialInk,
  getSequentialScale,
  getSequentialScaleHex,
  resolveChartHex,
  resolveSeriesColor,
  SEQ_MIN_PCT,
} from '@/lib/chart-colors'
import { DEFAULT_PALETTE } from '@/lib/config-schema'

// Real default tokens from globals.css, not the module's own fallback
// constants: the ink tests assert against these directly so the assertions
// exercise the app's actual light/dark columns, not a value the code under
// test also owns.
const LIGHT_TOKENS = { card: '#FFFFFF', chart1: '#485EA7', foreground: '#1C1B18' }
const DARK_TOKENS = { card: '#12161F', chart1: '#4A61AA', foreground: '#E7E9EE' }

function setTokens(tokens: { card: string; chart1: string; foreground: string }): void {
  document.documentElement.style.setProperty('--card', tokens.card)
  document.documentElement.style.setProperty('--chart-1', tokens.chart1)
  document.documentElement.style.setProperty('--foreground', tokens.foreground)
}

function clearTokens(): void {
  document.documentElement.style.removeProperty('--card')
  document.documentElement.style.removeProperty('--chart-1')
  document.documentElement.style.removeProperty('--foreground')
}

// getSequentialInk mixes its ramp in OKLab (matching the DOM, which paints
// color-mix(in oklab, ...)), NOT the sRGB lerp getSequentialScaleHex uses for
// WebGL. This mirrors that OKLab mix with chart-palette's own exported
// primitives, so the ink tests below measure the color getSequentialInk
// actually computes, rather than an sRGB approximation of it.
function mixOklabHex(hexA: string, hexB: string, t: number): string {
  const [aL, aA, aB] = hexToOklab(hexA)
  const [bL, bA, bB] = hexToOklab(hexB)
  const L = aL + (bL - aL) * t
  const a = aA + (bA - aA) * t
  const b = aB + (bB - aB) * t
  return oklabToHex(L, Math.hypot(a, b), Math.atan2(b, a))
}

// Same mix-percentage formula getSequentialInk uses internally, so a test can
// ask for the ramp color at a given value without re-deriving the formula.
function mixFraction(value: number, min: number, max: number): number {
  if (max === min) return 1
  const normalized = Math.max(0, Math.min(1, (value - min) / (max - min)))
  // Rounded, because getSequentialScale rounds before handing the percentage to
  // color-mix and getSequentialInk matches it. An unrounded helper here would
  // measure a color the DOM never paints.
  return Math.round(SEQ_MIN_PCT + normalized * (100 - SEQ_MIN_PCT)) / 100
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.documentElement.style.removeProperty('--chart-count')
})

describe('chart-colors', () => {
  it('returns the same var(--chart-N) form on the server and the client (hydration-safe)', () => {
    vi.stubGlobal('window', undefined)
    const palette = getChartPalette()
    // No server/client branch: getChartPalette emits CSS var references
    // unconditionally, so a server-rendered chart and its client hydration
    // pass produce byte-identical output instead of a hex-vs-var mismatch.
    expect(palette).toEqual(Array.from({ length: 8 }, (_, i) => `var(--chart-${i + 1})`))
  })

  it('resolves live CSS vars in the browser', () => {
    // jsdom provides window, so getChartPalette returns var(--chart-N).
    const palette = getChartPalette()
    expect(palette[0]).toBe('var(--chart-1)')
  })

  it('always returns PALETTE_SIZE (8) entries', () => {
    const palette = getChartPalette()
    expect(palette).toHaveLength(8)
    expect(palette).toEqual(Array.from({ length: 8 }, (_, i) => `var(--chart-${i + 1})`))
  })

  it('no longer reads --chart-count: the slot count stays fixed regardless of the CSS var', () => {
    // The window/--chart-count runtime branch was removed as part of the
    // hydration fix, so a stale or tenant-set --chart-count no longer changes
    // the palette length returned here.
    document.documentElement.style.setProperty('--chart-count', '3')
    const palette = getChartPalette()
    expect(palette).toHaveLength(8)
    expect(palette).toEqual(Array.from({ length: 8 }, (_, i) => `var(--chart-${i + 1})`))
  })

  it('honors an explicit per-series color override', () => {
    const color = resolveSeriesColor('Revenue', 0, { seriesOptions: { Revenue: { color: '#123456' } } })
    expect(color).toBe('#123456')
  })

  it('falls back to the palette by index when no override is given', () => {
    // Browser branch: index 0 maps to the first CSS var.
    expect(resolveSeriesColor('A', 0)).toBe('var(--chart-1)')
  })
})

describe('resolveChartHex', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--chart-1')
  })

  it('falls back to DEFAULT_PALETTE hex when the CSS vars are not set', () => {
    // jsdom does not apply globals.css, so with no inline vars resolveChartHex
    // must fall back to the concrete schema default (slot 1).
    expect(resolveChartHex(0)).toBe(DEFAULT_PALETTE[0])
  })

  it('returns the configured --chart-N value when the CSS var is set', () => {
    document.documentElement.style.setProperty('--chart-1', '#123456')
    expect(resolveChartHex(0)).toBe('#123456')
  })

  it('wraps the fallback index into DEFAULT_PALETTE when the var is unset', () => {
    // DEFAULT_PALETTE now fills all 8 slots, so index 8 is the first wrap.
    expect(resolveChartHex(DEFAULT_PALETTE.length)).toBe(DEFAULT_PALETTE[0])
  })
})

describe('getSequentialScale (CSS vars for DOM paints)', () => {
  it('is one hue: mixes the card surface with slot 1, never a second slot', () => {
    const scale = getSequentialScale(0, 10)
    expect(scale(10)).toContain('var(--chart-1)')
    expect(scale(10)).toContain('var(--card)')
    expect(scale(5)).not.toContain('var(--chart-2)')
  })

  it('rises monotonically from the surface floor to full strength', () => {
    const scale = getSequentialScale(0, 100)
    const pct = (v: number) => {
      const match = scale(v).match(/ (\d+)%\)$/)
      if (!match) throw new Error('expected the color-mix string to end in a percentage')
      return Number(match[1])
    }
    expect(pct(0)).toBe(SEQ_MIN_PCT)
    expect(pct(100)).toBe(100)
    expect(pct(25)).toBeLessThan(pct(50))
    expect(pct(50)).toBeLessThan(pct(75))
  })

  it('clamps out-of-range values', () => {
    const scale = getSequentialScale(0, 10)
    expect(scale(20)).toBe(scale(10))
    expect(scale(-5)).toBe(scale(0))
  })

  it('returns full strength when min equals max', () => {
    expect(getSequentialScale(5, 5)(5)).toBe('var(--chart-1)')
  })
})

describe('getSequentialInk (label ink that stays legible on the ramp)', () => {
  afterEach(clearTokens)

  it('against the real light tokens, picks foreground ink at the floor and card ink at full strength, both clearing AA', () => {
    setTokens(LIGHT_TOKENS)
    const ink = getSequentialInk(0, 100)

    expect(ink(0)).toBe('var(--foreground)')
    const rampAtFloor = mixOklabHex(LIGHT_TOKENS.card, LIGHT_TOKENS.chart1, mixFraction(0, 0, 100))
    expect(contrast(LIGHT_TOKENS.foreground, rampAtFloor)).toBeGreaterThanOrEqual(4.5)

    expect(ink(100)).toBe('var(--card)')
    const rampAtFull = mixOklabHex(LIGHT_TOKENS.card, LIGHT_TOKENS.chart1, mixFraction(100, 0, 100))
    expect(contrast(LIGHT_TOKENS.card, rampAtFull)).toBeGreaterThanOrEqual(4.5)
  })

  it('against the real dark tokens, picks foreground ink across the whole range, since the ramp gets lighter as the value rises there', () => {
    setTokens(DARK_TOKENS)
    const ink = getSequentialInk(0, 100)

    for (const value of [0, 25, 50, 75, 100]) {
      expect(ink(value)).toBe('var(--foreground)')
    }
    // Full strength is the worst case for foreground ink in this theme (the
    // ramp is closest to --chart-1 there), and it still clears AA.
    const rampAtFull = mixOklabHex(DARK_TOKENS.card, DARK_TOKENS.chart1, mixFraction(100, 0, 100))
    expect(contrast(DARK_TOKENS.foreground, rampAtFull)).toBeGreaterThanOrEqual(4.5)
  })

  it('uses card ink when min equals max, matching the solid scale color', () => {
    setTokens(LIGHT_TOKENS)
    expect(getSequentialInk(5, 5)(5)).toBe('var(--card)')
  })

  it('on an arbitrary tenant color, picks the ink that clears AA against the OKLab-painted ramp, not the sRGB approximation of it', () => {
    // Fixture values deliberately distinct from CARD_FALLBACK_HEX (#FFFFFF)
    // and FOREGROUND_FALLBACK_HEX (#1C1B18), so this test cannot pass via a
    // silent fallback read standing in for a real CSS var read.
    const tokens = { card: '#F6F4EE', chart1: '#0601FD', foreground: '#201E1A' }
    setTokens(tokens)
    const ink = getSequentialInk(0, 100)

    // value=50 of a [0, 100] range mixes to 60% strength (the SEQ_MIN_PCT
    // floor plus half the remaining range): the review's counterexample mix.
    const chosen = ink(50)
    const chosenHex = chosen === 'var(--foreground)' ? tokens.foreground : tokens.card
    const rampHex = mixOklabHex(tokens.card, tokens.chart1, mixFraction(50, 0, 100))

    // Regression guard for the sRGB-vs-OKLab bug: mixing this ramp in sRGB
    // (as the pre-fix code did) flips the choice to card ink, which fails to
    // clear even 3.5:1 against the color actually painted.
    expect(chosen).toBe('var(--foreground)')
    expect(contrast(chosenHex, rampHex)).toBeGreaterThanOrEqual(4.5)
  })

  it('measures the rounded percentage the DOM paints, not the unrounded one', () => {
    // getSequentialScale rounds before handing the percentage to color-mix, so
    // measuring the unrounded mix evaluates a color one step off what is
    // painted. Near a contrast crossover that one step flips the pick.
    //
    // These token values are load-bearing and must not be swapped for
    // fallback-distinct ones: the crossover only sits between the two mixes
    // for this exact combination. chart-1 (#A51658) is distinct from
    // DEFAULT_PALETTE[0], so a real CSS var read is still being exercised.
    const tokens = { card: '#FFFFFF', chart1: '#A51658', foreground: '#1C1B18' }
    setTokens(tokens)

    const value = 69.375
    expect(getSequentialScale(0, 100)(value)).toContain('76%')

    const paintedHex = mixOklabHex(tokens.card, tokens.chart1, 0.76)
    const unroundedHex = mixOklabHex(tokens.card, tokens.chart1, 0.755)

    // The discriminator. At the painted 76% card wins (4.23:1 against 4.07:1),
    // but at the unrounded 75.5% foreground wins. If the rounding alignment in
    // getSequentialInk were removed, the assertion below would flip to
    // foreground and this test would fail.
    expect(contrast(tokens.card, paintedHex)).toBeGreaterThan(contrast(tokens.foreground, paintedHex))
    expect(contrast(tokens.foreground, unroundedHex)).toBeGreaterThanOrEqual(
      contrast(tokens.card, unroundedHex)
    )

    expect(getSequentialInk(0, 100)(value)).toBe('var(--card)')
  })
})

describe('getSequentialScaleHex (concrete rgb for WebGL paints)', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--chart-1')
    document.documentElement.style.removeProperty('--card')
  })

  it('interpolates from the card surface to slot 1 in oklab', () => {
    document.documentElement.style.setProperty('--card', '#000000')
    document.documentElement.style.setProperty('--chart-1', '#ffffff')
    const scale = getSequentialScaleHex(0, 100)
    // t=0 sits at the SEQ_MIN_PCT floor, not at the bare surface, so the
    // lightest cell stays visible against the card. That floor is 20% of the
    // way in OKLab, which is perceptual lightness, so it lands at 22/255 and
    // not at the 51/255 a linear sRGB lerp would give. Black to white is the
    // pathological pair that maximizes the gap between the two spaces; on the
    // default white-to-indigo ramp the whole range differs by at most 5/255.
    expect(scale(0)).toBe('rgb(22, 22, 22)')
    expect(scale(100)).toBe('rgb(255, 255, 255)')
  })

  it('returns the full-strength color when min equals max', () => {
    document.documentElement.style.setProperty('--card', '#000000')
    document.documentElement.style.setProperty('--chart-1', '#102030')
    expect(getSequentialScaleHex(4, 4)(4)).toBe('rgb(16, 32, 48)')
  })

  it('paints the same color as the CSS ramp for the same value', () => {
    // The two are twins: a choropleth (WebGL, concrete rgb) and a heatmap (DOM,
    // color-mix) showing the same value must not paint different colors. They
    // agree only if both mix in OKLab and both round the percentage the same
    // way. A saturated tenant color is the case that catches divergence: on the
    // default ramp sRGB and OKLab differ by at most 5/255, but here by up to 47.
    document.documentElement.style.setProperty('--card', '#FFFFFF')
    document.documentElement.style.setProperty('--chart-1', '#0601FD')

    const hexScale = getSequentialScaleHex(0, 100)
    for (const value of [0, 17, 25, 50, 69.375, 75, 100]) {
      const css = getSequentialScale(0, 100)(value)
      const pct = Number(/(\d+)%/.exec(css)?.[1])
      const expected = mixOklabHex('#FFFFFF', '#0601FD', pct / 100)
      const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(expected.slice(i, i + 2), 16))
      expect(hexScale(value)).toBe(`rgb(${r}, ${g}, ${b})`)
    }
  })
})
