import { describe, expect, it } from 'vitest'
import {
  CHART_PALETTE_SIZE,
  contrast,
  deltaE,
  deriveDarkColumn,
  effectivePalette,
  formatReport,
  hexToOklab,
  hueRadians,
  oklch,
  validatePalette,
} from '@/lib/chart-palette'
import {
  CHART_SURFACE_DARK,
  CHART_SURFACE_LIGHT,
  DEFAULT_PALETTE,
  DEFAULT_PALETTE_DARK,
} from '@/lib/config-schema'

describe('color math', () => {
  it('converts hex to OKLab with white at L=1 and black at L=0', () => {
    expect(hexToOklab('#FFFFFF')[0]).toBeCloseTo(1, 3)
    expect(hexToOklab('#000000')[0]).toBeCloseTo(0, 3)
  })

  it('tolerates a missing leading hash and surrounding whitespace', () => {
    expect(hexToOklab(' 485EA7 ')).toEqual(hexToOklab('#485EA7'))
  })

  it('reports OKLCH lightness and chroma for a known slot', () => {
    const [L, C] = oklch('#485EA7')
    expect(L).toBeGreaterThan(0.43)
    expect(L).toBeLessThan(0.77)
    expect(C).toBeGreaterThan(0.1)
  })

  it('measures gray as below the chroma floor', () => {
    expect(oklch('#808080')[1]).toBeLessThan(0.1)
  })

  it('computes WCAG contrast symmetrically', () => {
    expect(contrast('#FFFFFF', '#000000')).toBeCloseTo(21, 1)
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 1)
  })

  it('returns zero deltaE for a color against itself', () => {
    expect(deltaE('#485EA7', '#485EA7')).toBeCloseTo(0, 6)
  })

  it('collapses indigo and violet under protanopia', () => {
    // The defect this whole phase exists to fix: the shipping palette put
    // these two in adjacent slots at deltaE 0.5 under protan.
    expect(deltaE('#41569E', '#7A4E9E', 'protan')).toBeLessThan(1)
    expect(deltaE('#41569E', '#7A4E9E')).toBeGreaterThan(1)
  })
})

const NEW_LIGHT = ['#485EA7', '#2B7E4E', '#A37AC7', '#3570A2', '#89435E', '#BF8A32', '#1D9999', '#B25630']
const NEW_DARK = ['#4A61AA', '#2B7E4E', '#754998', '#4D8FC8', '#A05771', '#BF861D', '#1D9999', '#B55933']

const check = (report: ReturnType<typeof validatePalette>, name: string) => {
  const found = report.checks.find((c) => c.name === name)
  if (!found) throw new Error(`no check named ${name}`)
  return found
}

describe('validatePalette', () => {
  it('passes the new light column on a white card', () => {
    const report = validatePalette(NEW_LIGHT, { mode: 'light', surface: '#FFFFFF' })
    expect(report.checks.filter((c) => c.status === 'fail')).toEqual([])
    expect(report.ok).toBe(true)
  })

  it('passes the new dark column on the dark card, allowing the contrast relief warn', () => {
    const report = validatePalette(NEW_DARK, { mode: 'dark', surface: '#12161F' })
    expect(report.checks.filter((c) => c.status === 'fail')).toEqual([])
    expect(report.ok).toBe(true)
    // Violet sits at 2.73:1 by design; the relief rule covers it via legend
    // labels and the table view. A warn must never flip ok to false.
    expect(check(report, 'Contrast vs surface').status).toBe('warn')
  })

  it('fails the palette that ships today', () => {
    const shipping = ['#41569E', '#B4552D', '#2E7D4F', '#C08A2D', '#3E7CB1', '#7A4E9E', '#41569E', '#B4552D']
    const report = validatePalette(shipping, { mode: 'light', surface: '#FFFFFF' })
    expect(report.ok).toBe(false)
    expect(check(report, 'CVD separation').status).toBe('fail')
    expect(check(report, 'Normal-vision floor').status).toBe('fail')
  })

  it('fails a slot that reads gray', () => {
    const grayish = [...NEW_LIGHT.slice(0, 7), '#7A7A7A']
    const report = validatePalette(grayish, { mode: 'light', surface: '#FFFFFF' })
    expect(check(report, 'Chroma floor').status).toBe('fail')
    expect(check(report, 'Chroma floor').detail).toContain('#7A7A7A')
  })

  it('fails a slot outside the lightness band', () => {
    const tooDark = ['#0A0F2E', ...NEW_LIGHT.slice(1)]
    const report = validatePalette(tooDark, { mode: 'light', surface: '#FFFFFF' })
    expect(check(report, 'Lightness band').status).toBe('fail')
  })

  it('names the offending pair in the CVD detail', () => {
    const report = validatePalette(['#41569E', '#7A4E9E'], { mode: 'light', surface: '#FFFFFF' })
    expect(check(report, 'CVD separation').detail).toContain('#41569E')
    expect(check(report, 'CVD separation').detail).toContain('#7A4E9E')
  })

  it('reports every check even on a single-slot palette', () => {
    const report = validatePalette(['#485EA7'], { mode: 'light', surface: '#FFFFFF' })
    expect(report.checks.map((c) => c.name)).toEqual([
      'Lightness band',
      'Chroma floor',
      'CVD separation',
      'Normal-vision floor',
      'Contrast vs surface',
    ])
  })

  it('rejects a malformed hex rather than failing open', () => {
    expect(() => validatePalette(['nope'], { mode: 'light', surface: '#FFFFFF' })).toThrow(/hex color/)
  })
})

describe('effectivePalette', () => {
  it('cycle-fills a short palette up to the given size', () => {
    expect(effectivePalette(['#485EA7', '#2B7E4E'], 8)).toEqual([
      '#485EA7', '#2B7E4E', '#485EA7', '#2B7E4E', '#485EA7', '#2B7E4E', '#485EA7', '#2B7E4E',
    ])
  })

  it('truncates a palette longer than the given size instead of keeping every entry', () => {
    const long = [...NEW_LIGHT, '#111111', '#222222']
    expect(effectivePalette(long, 8)).toEqual(NEW_LIGHT)
  })

  it('defaults to CHART_PALETTE_SIZE (8) when no size is given', () => {
    expect(effectivePalette(['#485EA7'])).toHaveLength(CHART_PALETTE_SIZE)
  })

  it('returns an empty array for an empty input rather than dividing by zero', () => {
    expect(effectivePalette([])).toEqual([])
  })
})

// Finding 2: the validator, the emitter, and the fixed 8-slot renderer must
// agree on what actually ships. Validating the effective array (not the raw
// authored one) is what makes these two cases fail instead of silently
// passing.
describe('validating the effective palette (what actually renders)', () => {
  it('fails a one-color palette once cycle-filled to 8 identical adjacent slots', () => {
    const effective = effectivePalette(['#485EA7'])
    const report = validatePalette(effective, { mode: 'light', surface: CHART_SURFACE_LIGHT })
    expect(report.ok).toBe(false)
    expect(check(report, 'CVD separation').status).toBe('fail')
    expect(check(report, 'CVD separation').detail).toContain('deltaE 0.0')
  })

  it('ignores slots past 8 in a too-long palette rather than validating dead colors', () => {
    // A 9th color that would fail the chroma floor on its own must not affect
    // the result, because nothing ever renders var(--chart-9).
    const nineColors = [...DEFAULT_PALETTE, '#7A7A7A']
    const effective = effectivePalette(nineColors)
    expect(effective).toEqual(DEFAULT_PALETTE)
    const report = validatePalette(effective, { mode: 'light', surface: CHART_SURFACE_LIGHT })
    expect(report.checks.filter((c) => c.status === 'fail')).toEqual([])
  })
})

describe('formatReport', () => {
  it('formats a header line plus one line per check, in check order', () => {
    const report = validatePalette(['#485EA7'], { mode: 'light', surface: '#FFFFFF' })
    const output = formatReport(report)
    const lines = output.split('\n')
    expect(lines[0]).toBe('Palette (light, surface #FFFFFF): OK')
    expect(lines).toHaveLength(1 + report.checks.length)
    report.checks.forEach((check, i) => {
      expect(lines[i + 1]).toBe(
        `  [${check.status.toUpperCase().padEnd(4)}] ${check.name.padEnd(22)} ${check.detail}`
      )
    })
  })

  it('labels a failed report as FAILED and preserves the failing check lines', () => {
    const report = validatePalette(['#41569E', '#7A4E9E'], { mode: 'light', surface: '#FFFFFF' })
    const output = formatReport(report)
    expect(output.startsWith('Palette (light, surface #FFFFFF): FAILED')).toBe(true)
    expect(output).toContain('[FAIL] CVD separation')
    expect(output).toContain('[FAIL] Normal-vision floor')
  })

  it('never emits an em dash or en dash, on a passing or a failing report', () => {
    const passing = formatReport(validatePalette(DEFAULT_PALETTE, { mode: 'light', surface: CHART_SURFACE_LIGHT }))
    const failing = formatReport(validatePalette(['#41569E', '#7A4E9E'], { mode: 'light', surface: '#FFFFFF' }))
    expect(passing).not.toMatch(/[\u2013\u2014]/)
    expect(failing).not.toMatch(/[\u2013\u2014]/)
  })
})

describe('deriveDarkColumn', () => {
  it('returns one step per input slot', () => {
    expect(deriveDarkColumn(NEW_LIGHT)).toHaveLength(8)
  })

  it('puts every derived step inside the dark band', () => {
    for (const hex of deriveDarkColumn(NEW_LIGHT)) {
      const [L, C] = oklch(hex)
      expect(L).toBeGreaterThanOrEqual(0.48)
      expect(L).toBeLessThanOrEqual(0.67)
      expect(C).toBeGreaterThanOrEqual(0.1)
    }
  })

  it('preserves each slot hue within a degree', () => {
    const derived = deriveDarkColumn(NEW_LIGHT)
    derived.forEach((hex, i) => {
      const delta = Math.abs(hueRadians(hex) - hueRadians(NEW_LIGHT[i])) * (180 / Math.PI)
      expect(Math.min(delta, 360 - delta)).toBeLessThan(1)
    })
  })

  it('clears the hard gates for a palette that already passes in light', () => {
    const report = validatePalette(deriveDarkColumn(NEW_LIGHT), { mode: 'dark', surface: '#12161F' })
    expect(check(report, 'Lightness band').status).toBe('pass')
    expect(check(report, 'Chroma floor').status).toBe('pass')
  })

  it('lifts a too-dark input into the band rather than passing it through', () => {
    const [derived] = deriveDarkColumn(['#0A0F2E'])
    expect(oklch(derived)[0]).toBeGreaterThanOrEqual(0.48)
  })

  // Finding 3: isInGamut used to accept a candidate whose L and C round-tripped
  // even when oklabToHex had clipped its hue. #FA9B08 derived to #D77A00, an
  // OKLab hue shift of about 5.9 degrees, well outside the 1-degree contract
  // this suite otherwise holds derivation to.
  it('holds hue through derivation even when the direct step clips out of gamut', () => {
    const [derived] = deriveDarkColumn(['#FA9B08'])
    const delta = Math.abs(hueRadians(derived) - hueRadians('#FA9B08')) * (180 / Math.PI)
    expect(Math.min(delta, 360 - delta)).toBeLessThan(1)
  })

  // Finding 1: derivation guarantees per-color lightness and chroma, NOT pair
  // separation. This light pair clears every light-mode check outright, but
  // its derived dark pair fails both CVD and normal-vision separation, so a
  // caller that validates only the light column (as config.ts and the CLI
  // used to) reports success while shipping a failing dark column.
  it('can derive a failing dark pair from a light pair that passes every light check', () => {
    const light = ['#6825AD', '#2B64D0']
    const lightReport = validatePalette(light, { mode: 'light', surface: CHART_SURFACE_LIGHT })
    expect(lightReport.ok).toBe(true)

    const dark = deriveDarkColumn(light)
    expect(dark).toEqual(['#7332BA', '#2A64D2'])
    const darkReport = validatePalette(dark, { mode: 'dark', surface: CHART_SURFACE_DARK })
    expect(darkReport.ok).toBe(false)
    expect(check(darkReport, 'CVD separation').status).toBe('fail')
    expect(check(darkReport, 'Normal-vision floor').status).toBe('fail')
  })
})

// This is the gate that matters most: the default palette is what almost every
// install runs. Editing a default hex without re-validating fails here.
describe('shipped default palettes', () => {
  it('fills all 8 slots without cycling', () => {
    expect(DEFAULT_PALETTE).toHaveLength(8)
    expect(DEFAULT_PALETTE_DARK).toHaveLength(8)
    expect(new Set(DEFAULT_PALETTE).size).toBe(8)
    expect(new Set(DEFAULT_PALETTE_DARK).size).toBe(8)
  })

  it('passes every hard gate on the light card', () => {
    const report = validatePalette(DEFAULT_PALETTE, { mode: 'light', surface: CHART_SURFACE_LIGHT })
    expect(report.checks.filter((c) => c.status === 'fail')).toEqual([])
  })

  it('passes every hard gate on the dark card', () => {
    const report = validatePalette(DEFAULT_PALETTE_DARK, { mode: 'dark', surface: CHART_SURFACE_DARK })
    expect(report.checks.filter((c) => c.status === 'fail')).toEqual([])
  })

  it('keeps the two columns in the same slot order, hue by hue', () => {
    DEFAULT_PALETTE.forEach((light, i) => {
      const delta = Math.abs(hueRadians(light) - hueRadians(DEFAULT_PALETTE_DARK[i])) * (180 / Math.PI)
      expect(Math.min(delta, 360 - delta)).toBeLessThan(12)
    })
  })
})
