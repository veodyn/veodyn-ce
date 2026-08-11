// Pure color math and palette validation. No DOM, no filesystem, no process:
// imported by config-schema.ts, which client code imports for the
// ClientConfig type. Runtime color lookup lives in chart-colors.ts instead.
//
// Thresholds and the CVD model are ported from the data-viz validator,
// calibrated to Machado, Oliveira & Fernandes (2009) at severity 1.0.

// normalizeHex lives in hex-color.ts (see that file for why it now also
// accepts the 3-digit shorthand); re-exported here so every existing
// `from '@/lib/chart-palette'` import keeps working unchanged. A relative
// import with an explicit .ts extension, not the `@/` alias:
// scripts/validate-palette.mjs loads this file straight through Node's own
// type-stripping ESM loader, which (like the .ts extension that script's own
// import of this file already needs) resolves extensionless specifiers no
// better than it resolves `@/`.
import { normalizeHex } from './hex-color.ts'
export { normalizeHex }

export type CvdKind = 'protan' | 'deutan' | 'tritan'

const MACHADO: Record<CvdKind, number[][]> = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
}

const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

const linearToSrgb = (c: number): number => {
  const v = Math.max(0, Math.min(1, c))
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
}

function linearRgb(hex: string): [number, number, number] {
  const h = normalizeHex(hex).slice(1)
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255)
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)]
}

function oklabFromLinear([r, g, b]: [number, number, number]): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

export function hexToOklab(hex: string): [number, number, number] {
  return oklabFromLinear(linearRgb(hex))
}

export function oklch(hex: string): [number, number] {
  const [L, a, b] = hexToOklab(hex)
  return [L, Math.hypot(a, b)]
}

export function oklabToHex(L: number, C: number, hueRadians: number): string {
  const a = C * Math.cos(hueRadians)
  const b = C * Math.sin(hueRadians)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  const hex = rgb
    .map((v) => Math.round(linearToSrgb(v) * 255).toString(16).padStart(2, '0'))
    .join('')
  return `#${hex.toUpperCase()}`
}

export function hueRadians(hex: string): number {
  const [, a, b] = hexToOklab(hex)
  return Math.atan2(b, a)
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = linearRgb(hex)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

function simulate(hex: string, kind: CvdKind): [number, number, number] {
  const [r, g, b] = linearRgb(hex)
  const M = MACHADO[kind]
  const clamp = (c: number) => Math.max(0, Math.min(1, c))
  return [
    clamp(M[0][0] * r + M[0][1] * g + M[0][2] * b),
    clamp(M[1][0] * r + M[1][1] * g + M[1][2] * b),
    clamp(M[2][0] * r + M[2][1] * g + M[2][2] * b),
  ]
}

// Euclidean distance in OKLab, scaled by 100. No kind means unsimulated vision.
export function deltaE(a: string, b: string, kind?: CvdKind): number {
  const x = oklabFromLinear(kind ? simulate(a, kind) : linearRgb(a))
  const y = oklabFromLinear(kind ? simulate(b, kind) : linearRgb(b))
  return 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])
}

const BAND: Record<PaletteMode, [number, number]> = {
  light: [0.43, 0.77],
  dark: [0.48, 0.67],
}
const CHROMA_FLOOR = 0.1
const CVD_TARGET = 8.0
const CVD_FLOOR = 6.0
const NORMAL_FLOOR = 15.0
const CONTRAST_MIN = 3.0

export type PaletteMode = 'light' | 'dark'

export interface PaletteCheck {
  name: string
  status: 'pass' | 'warn' | 'fail'
  detail: string
}

export interface PaletteReport {
  ok: boolean
  mode: PaletteMode
  surface: string
  checks: PaletteCheck[]
}

// The renderer (chart-colors.ts) is a fixed 8 slots: it only ever resolves
// var(--chart-1) through var(--chart-8). Single source of truth for that.
export const CHART_PALETTE_SIZE = 8

// Expands a short palette by cycling, or truncates a long one, to exactly
// `size` entries: the array that actually renders, which validation and the
// emitter must agree on (so a one-color palette cycle-fills and fails).
export function effectivePalette(hexes: string[], size: number = CHART_PALETTE_SIZE): string[] {
  if (hexes.length === 0) return []
  return Array.from({ length: size }, (_, i) => hexes[i % hexes.length])
}

export function validatePalette(
  hexes: string[],
  opts: { mode: PaletteMode; surface: string }
): PaletteReport {
  const palette = hexes.map(normalizeHex)
  const surface = normalizeHex(opts.surface)
  const [lo, hi] = BAND[opts.mode]
  const checks: PaletteCheck[] = []

  const outOfBand = palette.filter((c) => {
    const [L] = oklch(c)
    return L < lo || L > hi
  })
  checks.push({
    name: 'Lightness band',
    status: outOfBand.length ? 'fail' : 'pass',
    detail: outOfBand.length
      ? `outside L ${lo} to ${hi}: ${outOfBand.join(', ')}`
      : `all ${palette.length} inside L ${lo} to ${hi}`,
  })

  const lowChroma = palette.filter((c) => oklch(c)[1] < CHROMA_FLOOR)
  checks.push({
    name: 'Chroma floor',
    status: lowChroma.length ? 'fail' : 'pass',
    detail: lowChroma.length
      ? `below floor (reads gray): ${lowChroma.join(', ')}`
      : `all ${palette.length} at or above ${CHROMA_FLOOR}`,
  })

  // Adjacent pairs only: slot ORDER is the CVD-safety mechanism a chart draws.
  const adjacent: [string, string][] = palette
    .slice(0, -1)
    .map((c, i) => [c, palette[i + 1]] as [string, string])

  const worst = (kind?: CvdKind) =>
    adjacent.reduce(
      (acc, [a, b]) => {
        const d = kind
          ? Math.min(deltaE(a, b, 'protan'), deltaE(a, b, 'deutan'))
          : deltaE(a, b)
        return d < acc.d ? { d, a, b } : acc
      },
      { d: Number.POSITIVE_INFINITY, a: '', b: '' }
    )

  if (adjacent.length === 0) {
    checks.push({ name: 'CVD separation', status: 'pass', detail: 'single slot, no adjacent pair' })
    checks.push({ name: 'Normal-vision floor', status: 'pass', detail: 'single slot, no adjacent pair' })
  } else {
    const cvd = worst('protan')
    checks.push({
      name: 'CVD separation',
      status: cvd.d >= CVD_TARGET ? 'pass' : cvd.d >= CVD_FLOOR ? 'warn' : 'fail',
      detail: `worst adjacent ${cvd.a} to ${cvd.b} deltaE ${cvd.d.toFixed(1)} (min of protan/deutan)`,
    })

    const normal = worst()
    checks.push({
      name: 'Normal-vision floor',
      status: normal.d >= NORMAL_FLOOR ? 'pass' : 'fail',
      detail: `worst adjacent ${normal.a} to ${normal.b} deltaE ${normal.d.toFixed(1)} (unsimulated), floor ${NORMAL_FLOOR}`,
    })
  }

  // Never a fail: a sub-3:1 slot is legal WITH relief (visible labels or a table view).
  const lowContrast = palette
    .map((c) => [c, contrast(c, surface)] as const)
    .filter(([, cr]) => cr < CONTRAST_MIN)
  checks.push({
    name: 'Contrast vs surface',
    status: lowContrast.length ? 'warn' : 'pass',
    detail: lowContrast.length
      ? `below ${CONTRAST_MIN}:1, relief required: ${lowContrast.map(([c, cr]) => `${c} ${cr.toFixed(2)}`).join(', ')}`
      : `all ${palette.length} at or above ${CONTRAST_MIN}:1`,
  })

  return { ok: !checks.some((c) => c.status === 'fail'), mode: opts.mode, surface, checks }
}

function angularDelta(a: number, b: number): number {
  const diff = Math.abs(a - b) % (2 * Math.PI)
  return diff > Math.PI ? 2 * Math.PI - diff : diff
}

// ~0.5 degrees: inside the 1-degree hue-holding contract deriveDarkColumn's
// own tests check, with margin so a good candidate is not rejected.
const HUE_TOLERANCE_RADIANS = (0.5 * Math.PI) / 180

// A hex is only usable if it round-trips: oklabToHex clamps out-of-gamut
// channels, so L, C, AND hue must all be re-checked, not just L and C (the
// old check let a clipped candidate through when only hue drifted: #FA9B08
// requested at its own hue derived to #D77A00, a hue shift of about 5.9
// degrees, while L and C still round-tripped inside tolerance).
function isInGamut(L: number, C: number, hue: number): boolean {
  const hex = oklabToHex(L, C, hue)
  const [gotL, gotC] = oklch(hex)
  const gotHue = hueRadians(hex)
  return (
    Math.abs(gotL - L) < 0.02 &&
    Math.abs(gotC - C) < 0.02 &&
    angularDelta(gotHue, hue) < HUE_TOLERANCE_RADIANS
  )
}

// Derives a dark-surface column from a light one by holding each slot's hue
// and re-stepping lightness and chroma into the dark band. Mechanical and
// always in-band, so a tenant who configures only theme.chart_palette still
// gets a working dark mode. The default build hand-picks its dark column in
// config-schema.ts instead, because selected beats derived.
//
// Guarantees per-color lightness and chroma, NOT pair separation: light
// `#6825AD,#2B64D0` passes light validation but derives to `#7332BA,#2A64D2`,
// which fails CVD/normal-vision separation. Callers must validate it too.
export function deriveDarkColumn(lightHexes: string[]): string[] {
  const [lo, hi] = BAND.dark
  return lightHexes.map((hex) => {
    const source = normalizeHex(hex)
    const hue = hueRadians(source)
    const [srcL, srcC] = oklch(source)
    const targetL = Math.min(hi, Math.max(lo, srcL))
    const targetC = Math.max(CHROMA_FLOOR, srcC)

    let best: { hex: string; cost: number } | null = null
    for (let L = lo; L <= hi + 1e-9; L += 0.005) {
      for (let C = CHROMA_FLOOR; C <= 0.26; C += 0.005) {
        if (!isInGamut(L, C, hue)) continue
        // isInGamut checks fidelity to the request, not band membership: an
        // 8-bit hex can round-trip within tolerance yet sit just outside the
        // band. Recheck the re-derived L and C against band and floor here.
        const candidate = oklabToHex(L, C, hue)
        const [gotL, gotC] = oklch(candidate)
        if (gotL < lo || gotL > hi || gotC < CHROMA_FLOOR) continue
        const cost = Math.abs(L - targetL) * 3 + Math.abs(C - targetC)
        if (!best || cost < best.cost) best = { hex: candidate, cost }
      }
    }
    if (!best) {
      // Every step at this hue is out of gamut at the floor: fall back to the
      // mid-band step, so derivation always returns a usable column.
      return oklabToHex((lo + hi) / 2, CHROMA_FLOOR, hue)
    }
    return best.hex
  })
}

export function formatReport(report: PaletteReport): string {
  const head = `Palette (${report.mode}, surface ${report.surface}): ${report.ok ? 'OK' : 'FAILED'}`
  const lines = report.checks.map(
    (c) => `  [${c.status.toUpperCase().padEnd(4)}] ${c.name.padEnd(22)} ${c.detail}`
  )
  return [head, ...lines].join('\n')
}
