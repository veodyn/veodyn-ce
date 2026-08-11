// Hex color string parsing, split out of chart-palette.ts (which was at the
// file-size hook's limit) rather than folded in there: parsing a hex STRING
// is a different concern from the CVD simulation and palette-validation
// policy the rest of that file owns.

const HEX_RE = /^#?[0-9a-fA-F]{6}$/
const HEX_SHORT_RE = /^#?[0-9a-fA-F]{3}$/

// Unguarded, parseInt propagates NaN through every check and a run fails OPEN
// (reporting a pass it never verified), so every entry point normalizes here.
//
// Also accepts the 3-digit shorthand (#abc): Lightning CSS minifies any
// #rrggbb whose three channel pairs are each a doubled digit down to #rgb in
// the CSS it actually ships (#FFFFFF -> #fff). getSequentialInk and
// getSequentialScaleHex read --card via getComputedStyle at runtime, so in a
// built app that value genuinely arrives 3-digit, not just in a hand-authored
// stylesheet; rejecting it crashed every heatmap/choropleth render whose
// domain wasn't a single value. No jsdom test caught this, since jsdom
// fixtures set CSS vars directly (document.documentElement.style.
// setProperty), bypassing the build's own minifier entirely.
// The real boundary this function guards: a value read off getComputedStyle
// can be ANY CSS color syntax a browser is willing to serialize a custom
// property back as, not only #rrggbb or #rgb. oklch(...), rgb(...), an
// 8-digit #rrggbbaa, and the 4-digit #rgba shorthand would all still throw
// here. Nothing in this codebase's own tokens currently emits one of those
// forms, so widening further has been left until something actually needs
// it, not done speculatively.
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
