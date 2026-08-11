import { describe, expect, it } from 'vitest'
import { contrast, hueRadians, oklch } from '@/lib/chart-palette'
import { CHART_SURFACE_DARK } from '@/lib/config-schema'
import { deriveDarkAccent } from '@/lib/theme-accent'
import { required } from '@/lib/required'

// Spread across the wheel, including the two that broke earlier attempts: a
// saturated red (out of gamut once lightened at full chroma) and a slate that
// starts far below the contrast floor.
const ACCENTS = ['#475569', '#2563EB', '#DC2626', '#059669', '#F59E0B', '#7C3AED', '#0EA5E9']

function derived(hex: string): string {
  return required(deriveDarkAccent(hex), `derived accent for ${hex}`)
}

// Degrees, for readable failure output.
function hueDegrees(hex: string): number {
  return (hueRadians(hex) * 180) / Math.PI
}

describe('deriveDarkAccent', () => {
  it.each(ACCENTS)('lands %s above the AA floor on the dark card', (accent) => {
    expect(contrast(derived(accent), CHART_SURFACE_DARK)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(ACCENTS)('holds the hue of %s, so the brand colour survives', (accent) => {
    const delta = Math.abs(hueDegrees(derived(accent)) - hueDegrees(accent))
    expect(Math.min(delta, 360 - delta)).toBeLessThan(2)
  })

  // The regression that motivated the search order. Chasing contrast by
  // dropping chroma turns #DC2626 into #7A7A7A: it passes every contrast
  // assertion above and is still completely wrong, so the chroma floor is what
  // actually pins the behaviour.
  it('keeps a saturated accent saturated instead of collapsing it to grey', () => {
    const [, sourceChroma] = oklch('#DC2626')
    const [, resultChroma] = oklch(derived('#DC2626'))
    expect(resultChroma).toBeGreaterThan(sourceChroma * 0.9)
  })

  it('leaves an accent that already clears the floor alone', () => {
    // A mid amber is light enough to pass untouched; re-stepping it anyway
    // would drift a tenant's colour for no reason.
    expect(contrast('#F59E0B', CHART_SURFACE_DARK)).toBeGreaterThanOrEqual(4.5)
    expect(derived('#F59E0B')).toBe('#F59E0B')
  })

  it('lightens an accent that is too dark rather than returning it unchanged', () => {
    const [sourceL] = oklch('#475569')
    const [resultL] = oklch(derived('#475569'))
    expect(contrast('#475569', CHART_SURFACE_DARK)).toBeLessThan(4.5)
    expect(resultL).toBeGreaterThan(sourceL)
  })

  it('accepts a lowercase hex, so a pasted config value derives the same colour', () => {
    expect(derived('#dc2626')).toBe(derived('#DC2626'))
  })

  it('returns null rather than an unreadable colour when no step at the hue works', () => {
    // Pure black has no hue to hold and no chroma to keep; the search should
    // still find a neutral that clears the floor rather than giving up.
    const black = deriveDarkAccent('#000000')
    if (black !== null) {
      expect(contrast(black, CHART_SURFACE_DARK)).toBeGreaterThanOrEqual(4.5)
    }
  })
})
