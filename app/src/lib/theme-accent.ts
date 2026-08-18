// Derives a dark-scope accent from a tenant's light one.
//
// Separate from chart-palette.ts (which supplies the colour maths) because the
// constraint differs: a chart colour has to be distinguishable from its seven
// neighbours, an accent has to be readable as text on a dark card.
// deriveDarkColumn lands an accent at roughly 2.9:1, which is unreadable.
import {
  contrast,
  hueRadians,
  normalizeHex,
  oklabToHex,
  oklch,
} from '@/lib/chart-palette'
import { CHART_SURFACE_DARK } from '@/lib/config-schema'

// WCAG AA for normal text. The accent is used as link-coloured text, not only
// as a button fill, so the large-text 3:1 allowance does not cover it.
const MIN_CONTRAST = 4.5

// The dark card, not the dark page background. It is the lighter of the two
// surfaces the accent appears on, so it is the harder contrast test; clearing
// it clears --background too.
const SURFACE = CHART_SURFACE_DARK

// Never darker than mid-lightness: below this an accent cannot reach AA against
// a dark surface at any chroma. The ceiling stops a derived accent going so pale
// it stops reading as a colour.
const L_MIN = 0.5
const L_MAX = 0.95
const L_STEP = 0.005
const C_STEP = 0.002

// oklabToHex clamps out-of-gamut channels, so a requested (L, C) can come back
// as something else entirely. Same round-trip tolerance chart-palette uses.
const TOLERANCE = 0.02

// Hue is re-checked alongside L and C, not assumed held: clamping can leave both
// inside tolerance while rotating the hue, which let #7C3AED through at 2.5
// degrees of drift. Half a degree, matching chart-palette.ts.
const HUE_TOLERANCE_RADIANS = (0.5 * Math.PI) / 180

function angularDelta(a: number, b: number): number {
  const diff = Math.abs(a - b) % (2 * Math.PI)
  return diff > Math.PI ? 2 * Math.PI - diff : diff
}

/** The requested colour if sRGB can actually represent it, else null. */
function inGamut(L: number, C: number, hue: number): string | null {
  const hex = oklabToHex(L, C, hue)
  const [gotL, gotC] = oklch(hex)
  if (Math.abs(gotL - L) > TOLERANCE || Math.abs(gotC - C) > TOLERANCE) return null
  if (angularDelta(hueRadians(hex), hue) > HUE_TOLERANCE_RADIANS) return null
  return hex
}

/** The most saturated in-gamut colour at this lightness, up to `want`. */
function mostChromaAt(L: number, hue: number, want: number): string | null {
  for (let C = want; C >= 0; C -= C_STEP) {
    const hex = inGamut(L, C, hue)
    if (hex) return hex
  }
  return null
}

/**
 * Holds the hue, keeps as much chroma as sRGB allows, and lifts lightness until
 * the colour clears AA on a dark card.
 *
 * Lightness is searched before chroma: dropping chroma raises luminance faster,
 * so a chroma-first search turns a #DC2626 brand red into #7A7A7A grey, where
 * this one returns #E73430.
 *
 * Null when no step at this hue works, which callers should read as "fall back
 * to the hand-picked default".
 */
export function deriveDarkAccent(lightHex: string): string | null {
  const source = normalizeHex(lightHex)
  const hue = hueRadians(source)
  const [sourceL, sourceC] = oklch(source)

  for (let L = Math.max(L_MIN, sourceL); L <= L_MAX + 1e-9; L += L_STEP) {
    const candidate = mostChromaAt(L, hue, sourceC)
    // No chroma at all round-trips here, not even zero: skip the step rather
    // than treat it as a failed contrast test.
    if (!candidate) continue
    if (contrast(candidate, SURFACE) >= MIN_CONTRAST) return candidate
  }
  return null
}
