// Checks a chart palette against the same gates CI runs, so a tenant can verify
// their brand colors before deploying. With no argument it checks the shipped
// defaults. Only the first argument is read; anything after it is ignored.
//
// Usage:
//   pnpm validate:palette
//   pnpm validate:palette "#485EA7,#2B7E4E,#A37AC7"
//
// Requires Node 24 or later (this repo's package.json engines.node). It imports
// .ts modules with a plain ESM `import`, which Node 23.6+ handles by stripping
// erasable types; there is no tsx or ts-node here, so an older runtime fails to
// resolve them at all. That import also makes Node emit
// MODULE_TYPELESS_PACKAGE_JSON, which the package.json script silences: the
// reparse cost is immaterial for a one-shot CLI, but do not silence it if you
// copy this pattern into a long-running process.
import { validatePalette, formatReport, deriveDarkColumn, effectivePalette, CHART_PALETTE_SIZE } from '../src/lib/chart-palette.ts'
import {
  DEFAULT_PALETTE,
  DEFAULT_PALETTE_DARK,
  CHART_SURFACE_LIGHT,
  CHART_SURFACE_DARK,
} from '../src/lib/config-schema.ts'

const arg = process.argv[2]

// No argument means the shipped defaults. An empty argument is treated as
// invalid input rather than as a request for them.
let authored = null
if (arg !== undefined) {
  authored = arg
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (authored.length === 0) {
    console.error('No colors given. Pass a comma-separated list of hex colors, or no argument at all to check the shipped defaults.')
    process.exit(1)
  }
}

let failed = false
try {
  let runs
  if (authored === null) {
    // The shipped dark column is hand-picked and validated as a set (see
    // config-schema.ts), not derived, so it is checked as given.
    runs = [
      { palette: DEFAULT_PALETTE, mode: 'light', surface: CHART_SURFACE_LIGHT, label: 'Light column (shipped default)' },
      { palette: DEFAULT_PALETTE_DARK, mode: 'dark', surface: CHART_SURFACE_DARK, label: 'Dark column (shipped default, hand-picked)' },
    ]
  } else {
    // The effective 8-slot array the renderer reads, not the raw authored list:
    // a one-color palette cycle-fills into 8 identical slots, and slots past 8
    // are never rendered.
    const light = effectivePalette(authored, CHART_PALETTE_SIZE)
    // Derivation holds each color's lightness and chroma in band but not pair
    // separation, so the derived dark column is checked too.
    const dark = deriveDarkColumn(light)
    runs = [
      { palette: light, mode: 'light', surface: CHART_SURFACE_LIGHT, label: 'Light column (as given)' },
      { palette: dark, mode: 'dark', surface: CHART_SURFACE_DARK, label: 'Dark column (derived from the light column)' },
    ]
  }

  for (const run of runs) {
    const report = validatePalette(run.palette, { mode: run.mode, surface: run.surface })
    console.log(run.label)
    console.log(formatReport(report))
    console.log('')
    if (!report.ok) failed = true
  }
} catch (err) {
  // normalizeHex throws a readable Error on malformed input. The audience is a
  // tenant pasting brand hex codes, so print the message without the stack.
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}

if (failed) {
  console.log('One or more checks FAILED. A contrast WARN is not a failure, but it obligates visible labels or a table view.')
}
process.exit(failed ? 1 : 0)
