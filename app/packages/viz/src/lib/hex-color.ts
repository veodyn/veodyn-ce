// Hex color string parsing for chart-palette.ts.

const HEX_RE = /^#?[0-9a-fA-F]{6}$/
const HEX_SHORT_RE = /^#?[0-9a-fA-F]{3}$/

// Unguarded, parseInt propagates NaN through every check and a run fails open,
// so every entry point normalizes here.
//
// The 3-digit shorthand (#abc) is accepted because Lightning CSS minifies
// #rrggbb down to #rgb in the CSS it ships (#FFFFFF -> #fff), and
// getSequentialInk / getSequentialScaleHex read --card off getComputedStyle at
// runtime. jsdom fixtures set CSS vars directly, so no test sees the minifier.
//
// Still throws on any other CSS color syntax getComputedStyle may serialize:
// oklch(...), rgb(...), #rrggbbaa, #rgba. No token here emits those yet.
export function normalizeHex(value: string): string {
  const trimmed = value.trim()
  if (HEX_SHORT_RE.test(trimmed)) {
    const [r, g, b] = trimmed.replace(/^#/, '')
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase()
  }
  if (!HEX_RE.test(trimmed)) {
    throw new Error(`[chart-palette] not a #rgb or #rrggbb hex color: ${JSON.stringify(value)}`)
  }
  return `#${trimmed.replace(/^#/, '').toUpperCase()}`
}
