// Builds the inline <style> block that overrides globals.css chart and accent
// tokens with the tenant's configured theme. Kept out of src/app/layout.tsx so
// it stays testable under jsdom (that file imports next/font and CSS).
//
// Both `:root` and `.dark` must be emitted. They share specificity (0,1,0), so
// this inline block wins on source order, and a `:root`-only emit paints the
// light accent in dark mode: 2.55:1 against the dark surface, where the
// stylesheet's own #7FA9E0 gets 7.96:1.
//
// A tenant palette gets its dark column derived (hue held, lightness and chroma
// re-stepped). An unmodified build keeps DEFAULT_PALETTE_DARK, which is
// hand-picked and validated as a set.
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
// request and deriveDarkColumn's grid search (measured about 14ms for an 8-slot
// column) is memoized for the process lifetime. Keyed on the normalized hex, so
// a cycle-filled short palette searches once per distinct color, not per slot.
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
 * The accent for the dark scope. An unmodified build gets DEFAULT_ACCENT_DARK,
 * the hex globals.css was designed around; a tenant accent is re-stepped for a
 * dark surface, falling back to the default when no step at that hue clears the
 * contrast floor.
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
  // Exactly CHART_PALETTE_SIZE slots, cycle-filled or truncated: the same
  // effective array chart-colors.ts renders and config.ts validates.
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
