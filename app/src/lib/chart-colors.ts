// Single source of truth for chart series colors, shared by chart, funnel,
// heatmap, and sankey renderers so they no longer each hardcode their own
// palette. Colors themselves live in globals.css (--chart-1..8, light/dark)
// by default, overridden per-tenant by theme injection (lib/theme-style.ts themeStyle).
import { contrast, hexToOklab, oklabToHex } from '@/lib/chart-palette'
import { DEFAULT_PALETTE } from '@/lib/config-schema'

const PALETTE_SIZE = 8

export function getChartPalette(): string[] {
  // Deterministic across SSR and client: emit CSS var references the browser resolves against the
  // active (tenant-injected) --chart-N tokens. The tenant palette injection cycle-fills all
  // PALETTE_SIZE slots, so indexing modulo PALETTE_SIZE yields the same resolved colors the old
  // --chart-count path did, without a server/client branch that breaks hydration.
  return Array.from({ length: PALETTE_SIZE }, (_, i) => `var(--chart-${i + 1})`)
}

interface SeriesColorOptions {
  seriesOptions?: Record<string, { color?: string }>
}

export function resolveSeriesColor(key: string, index: number, options?: SeriesColorOptions): string {
  const override = options?.seriesOptions?.[key]?.color
  if (override) return override
  const palette = getChartPalette()
  return palette[index % palette.length]
}

// The lightest step keeps this much slot-1 strength so a near-zero cell is
// still visibly a cell rather than blank card.
export const SEQ_MIN_PCT = 20

function normalize(value: number, min: number, max: number): number {
  if (max === min) return 1
  return Math.max(0, Math.min(1, (value - min) / (max - min)))
}

// Sequential color scale for heatmap and choropleth fills. ONE hue, light to
// dark: mixes the card surface with slot 1, so lightness rises monotonically
// across the data range. The previous version lerped slot 1 to slot 2, two
// unrelated hues, which moved OKLab lightness only 0.09 across the whole range
// and collapsed chroma to a gray mauve at the midpoint, making values either
// side of the middle indistinguishable.
export function getSequentialScale(min: number, max: number) {
  // A flat series has no magnitude to encode, so every cell takes the solid
  // slot color rather than a mix that implies a position on a range: a bare
  // var(--chart-1) reference, not the mix formula run at full strength. (The
  // hex twin below cannot take this shortcut: it has no "solid color" string
  // to return, only concrete rgb, so it runs the same formula at mix 1.0
  // instead. The two degenerate paths differ in shape on purpose.)
  if (max === min) return (): string => 'var(--chart-1)'
  return (value: number): string => {
    const pct = Math.round(SEQ_MIN_PCT + normalize(value, min, max) * (100 - SEQ_MIN_PCT))
    return `color-mix(in oklab, var(--card), var(--chart-1) ${pct}%)`
  }
}

// Concrete-hex helpers for renderers that paint outside the DOM/CSS pipeline
// (MapLibre WebGL fills cannot resolve CSS custom properties or color-mix()).
// They read the SAME --chart-* tokens as getSequentialScale and mix them in the
// SAME color space (OKLab), so a choropleth and a heatmap showing the same value
// paint the same color. When the computed value is empty (SSR, or a test without
// inline vars), they fall back to DEFAULT_PALETTE.

export function readCssVarHex(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return raw || fallback
}

export function resolveChartHex(index: number): string {
  const fallback = DEFAULT_PALETTE[index % DEFAULT_PALETTE.length]
  return readCssVarHex(`--chart-${index + 1}`, fallback)
}

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '').trim()
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  const n = Number.parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// Concrete fallbacks for the Editorial Light neutral chrome tokens, resolved
// for renderers that paint outside CSS (MapLibre). Kept here so renderer files
// carry zero hex literals (viz-chrome-tokens guard).
export const MUTED_FALLBACK_HEX = '#F0EDE6'
export const BORDER_FALLBACK_HEX = '#E5E1D8'
export const CARD_FALLBACK_HEX = '#FFFFFF'
export const FOREGROUND_FALLBACK_HEX = '#1C1B18'

// Mixes two hex colors in OKLab, the same color space the DOM ramp is
// painted in (getSequentialScale emits color-mix(in oklab, ...)). hexToOklab
// returns cartesian [L, a, b], so the mix interpolates those components
// directly; oklabToHex takes polar [L, C, hue], so the mixed a/b pair is
// converted back to chroma and hue before the round trip out to hex.
// Interpolating hue directly (instead of a/b) would produce a different,
// wrong color whenever the two endpoints do not share a hue.
function mixOklab(hexA: string, hexB: string, t: number): string {
  const [aL, aA, aB] = hexToOklab(hexA)
  const [bL, bA, bB] = hexToOklab(hexB)
  const L = aL + (bL - aL) * t
  const a = aA + (bA - aA) * t
  const b = aB + (bB - aB) * t
  return oklabToHex(L, Math.hypot(a, b), Math.atan2(b, a))
}

export function getSequentialScaleHex(min: number, max: number): (value: number) => string {
  const cardHex = readCssVarHex('--card', CARD_FALLBACK_HEX)
  const chart1Hex = resolveChartHex(0)
  return (value: number): string => {
    // Mirrors getSequentialScale exactly: same floor, same rounding, and the
    // same OKLab mix, resolved to concrete rgb because MapLibre's WebGL fills
    // cannot read CSS custom properties or color-mix(). Mixing in sRGB here
    // instead would make a choropleth and a heatmap paint different colors for
    // the same value: on the default slot-1 ramp the two spaces diverge by up
    // to 5/255 per channel, and on a saturated tenant color by up to 47/255.
    const mix =
      max === min
        ? 1
        : Math.round(SEQ_MIN_PCT + normalize(value, min, max) * (100 - SEQ_MIN_PCT)) / 100
    const [r, g, b] = hexToRgb(mixOklab(cardHex, chart1Hex, mix))
    return `rgb(${r}, ${g}, ${b})`
  }
}

// Label ink for a cell painted by getSequentialScale at the same value. A
// fixed lightness threshold cannot pick the right ink in both themes: in the
// dark column --card is darker than --chart-1, so the ramp gets LIGHTER as
// the value rises, the opposite of the light column. Instead this resolves
// the three tokens once per factory call (not per cell: a heatmap calls this
// once per cell, and getComputedStyle is not cheap to run that often), then
// for each value mixes the ramp color in OKLab, matching what
// getSequentialScale actually paints via color-mix(in oklab, ...), and picks
// whichever of --foreground or --card has the higher real contrast against
// it, via chart-palette's contrast(). Mixing in sRGB instead would measure a
// color the DOM never paints and can flip the choice: on tenant color
// #0601FD at 60% mix, an sRGB mix picks card ink (about 3.11:1 against the
// real painted color) where OKLab correctly picks foreground ink (about
// 5.53:1).
export function getSequentialInk(min: number, max: number): (value: number) => string {
  const cardHex = readCssVarHex('--card', CARD_FALLBACK_HEX)
  const foregroundHex = readCssVarHex('--foreground', FOREGROUND_FALLBACK_HEX)
  const chart1Hex = resolveChartHex(0)
  return (value: number): string => {
    // Round exactly as getSequentialScale does before handing the percentage to
    // color-mix. Measuring the unrounded mix would evaluate a color one step off
    // the one the DOM paints, which is enough to flip the choice near a contrast
    // crossover: at value 69.375 of [0, 100] with chart-1 #A51658, the unrounded
    // 75.5% reads #C15B7E (foreground wins) while the painted 76% is #C0597D
    // (card wins, 4.23:1 against 4.07:1).
    const mix =
      max === min
        ? 1
        : Math.round(SEQ_MIN_PCT + normalize(value, min, max) * (100 - SEQ_MIN_PCT)) / 100
    const rampHex = mixOklab(cardHex, chart1Hex, mix)
    return contrast(foregroundHex, rampHex) >= contrast(cardHex, rampHex)
      ? 'var(--foreground)'
      : 'var(--card)'
  }
}
