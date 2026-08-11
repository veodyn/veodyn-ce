// Pure two-scope theme emitter. Builds the inline <style> block that
// overrides globals.css chart and accent tokens with the tenant's configured
// theme. Kept out of src/app/layout.tsx (which imports next/font and a CSS
// side-effect import, neither of which resolve under jsdom) so this stays
// testable with a plain object in, no DOM and no process.
//
// Two scopes, not one. This renders as an inline <style> inside <body>, and
// `:root` and `.dark` both have specificity (0,1,0), so source order decides
// and this block wins over globals.css. Emitting only `:root` would override
// dark mode with the light palette the moment a tenant sets
// theme.chart_palette. When a tenant supplies a palette, the dark column is
// derived from it (hue held, lightness and chroma re-stepped into the dark
// band) so they get a working dark mode without configuring a second
// palette. When the tenant has not overridden the palette, the built-in
// DEFAULT_PALETTE_DARK is used as is: it is hand-picked and validated as a
// set, and deriving from DEFAULT_PALETTE would produce a different,
// unvalidated palette.
//
// The accent has to be emitted for BOTH scopes for the same reason, and until
// dark mode became reachable that was a latent bug rather than a visible one.
// `:root { --primary }` here outranks `.dark { --primary }` in globals.css, so
// the dark scope was painting the LIGHT accent: measured at 2.55:1 against the
// dark surface, where the stylesheet's own hand-picked #7FA9E0 gets 7.96:1. A
// primary button on /wall was dark slate with near-black text on it.
import { CHART_PALETTE_SIZE, deriveDarkColumn, effectivePalette, normalizeHex } from '@/lib/chart-palette'
import {
  DEFAULT_ACCENT,
  DEFAULT_ACCENT_DARK,
  DEFAULT_PALETTE,
  DEFAULT_PALETTE_DARK,
  type VeodynConfig,
} from '@/lib/config-schema'
import { deriveDarkAccent } from '@/lib/theme-accent'

// layout.tsx sets `dynamic = 'force-dynamic'`, so themeStyle runs once per
// request, not once per process. deriveDarkColumn is a nested grid search
// (measured about 14ms for an 8-slot column), and config is read once at
// server start and never changes, so the derived dark hex for a given light
// hex is memoized here at module scope for the process lifetime. Keyed on
// the normalized hex, not the whole palette, so a cycle-filled short palette
// (which repeats colors to fill 8 slots) dedupes into a single search per
// distinct color instead of one per slot.
const darkHexCache = new Map<string, string>()

// The accent runs its own smaller search on the same once-per-request path.
const darkAccentCache = new Map<string, string>()

function normalizedEquals(a: string, b: string): boolean {
  return normalizeHex(a) === b
}

function isDefaultPalette(palette: string[]): boolean {
  return palette.length === DEFAULT_PALETTE.length && palette.every((hex, i) => normalizedEquals(hex, DEFAULT_PALETTE[i]))
}

function deriveDarkCached(lightHexes: string[]): string[] {
  const keys = lightHexes.map(normalizeHex)
  const uncached = [...new Set(keys.filter((key) => !darkHexCache.has(key)))]
  if (uncached.length > 0) {
    const derived = deriveDarkColumn(uncached)
    uncached.forEach((key, i) => darkHexCache.set(key, derived[i]))
  }
  return keys.map((key) => {
    const cached = darkHexCache.get(key)
    if (cached === undefined) {
      throw new Error(`[theme-style] derived dark color missing from cache for ${key}`)
    }
    return cached
  })
}

/**
 * The accent for the dark scope.
 *
 * An unmodified build gets DEFAULT_ACCENT_DARK, the hex globals.css was
 * designed around: selected beats derived, exactly as for the palette. A tenant
 * who has set their own accent gets it re-stepped for a dark surface, so
 * configuring one colour still leaves them with a working dark mode. If no step
 * at that hue can clear the contrast floor, the hand-picked default is used
 * rather than shipping an accent nobody can read.
 */
function darkAccentFor(accent: string): string {
  const key = normalizeHex(accent)
  if (normalizedEquals(DEFAULT_ACCENT, key)) return DEFAULT_ACCENT_DARK

  const cached = darkAccentCache.get(key)
  if (cached !== undefined) return cached

  const derived = deriveDarkAccent(key) ?? DEFAULT_ACCENT_DARK
  darkAccentCache.set(key, derived)
  return derived
}

export function themeStyle(config: Pick<VeodynConfig, 'theme'>): string {
  const palette = config.theme.chart_palette
  // Exactly CHART_PALETTE_SIZE slots, cycle-filled or truncated: this is the
  // same effective array chart-colors.ts's fixed 8-slot renderer resolves
  // and config.ts validates. A raw palette longer than 8 used to emit
  // --chart-9 and beyond here, which nothing ever reads; capping at the
  // renderer's own slot count keeps the emitter, the validator, and the
  // renderer telling one story about what actually ships.
  const light = effectivePalette(palette, CHART_PALETTE_SIZE)
  const dark = isDefaultPalette(palette) ? DEFAULT_PALETTE_DARK : deriveDarkCached(light)
  const vars = (colors: string[]) => colors.map((c, i) => `--chart-${i + 1}: ${c};`).join(' ')

  const accent = config.theme.accent
  const darkAccent = darkAccentFor(accent)

  return [
    `:root { --primary: ${accent}; --ring: ${accent}; ${vars(light)} }`,
    `.dark { --primary: ${darkAccent}; --ring: ${darkAccent}; ${vars(dark)} }`,
  ].join(' ')
}
