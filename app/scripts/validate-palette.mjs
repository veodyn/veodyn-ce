// Checks a chart palette against the same gates CI runs, so a tenant can verify
// their brand colors before deploying. With no argument it checks the shipped
// defaults. Only the first argument is read; anything after it is ignored.
//
// Usage:
//   pnpm validate:palette
//   pnpm validate:palette "#485EA7,#2B7E4E,#A37AC7"
//
// Requires Node 24 or later (matches this repo's package.json engines.node).
// This script imports chart-palette.ts and config-schema.ts directly with a
// plain ESM `import`: Node 23.6+ strips TypeScript types from .ts files with
// no loader or flag needed, as long as the syntax is "erasable" (no enums, no
// namespaces), which both of those modules are. There is no tsx, ts-node, or
// vite-node dependency in this project, so a runtime older than that will
// fail to resolve these imports at all, not just misbehave.
//
// Importing a .ts file this way makes Node emit a real, one-time
// MODULE_TYPELESS_PACKAGE_JSON warning: package.json has no "type" field, so
// Node has to sniff the module type and reparse as ESM, which the warning
// itself says "incurs a performance overhead." That cost is real, not merely
// cosmetic; it is just immaterial for a short-lived, one-shot CLI process,
// which is why the package.json script silences it with
// --disable-warning=MODULE_TYPELESS_PACKAGE_JSON instead of fixing the
// underlying cause (adding "type": "module" to package.json, a repo-wide
// change out of scope here). Anyone copying this .mjs-imports-.ts pattern
// into a hot path (a long-running server, a per-request import) should not
// silence the warning the same way: fix the cause there instead.
import { validatePalette, formatReport, deriveDarkColumn, effectivePalette, CHART_PALETTE_SIZE } from '../src/lib/chart-palette.ts'
import {
  DEFAULT_PALETTE,
  DEFAULT_PALETTE_DARK,
  CHART_SURFACE_LIGHT,
  CHART_SURFACE_DARK,
} from '../src/lib/config-schema.ts'

const arg = process.argv[2]

// arg is undefined when no argument was given at all: use the shipped
// defaults. arg is '' (or all commas/whitespace) when one was given but it
// was empty: that is almost certainly a mistake (an empty-quoted argument),
// not a deliberate request for the defaults, so it is treated as invalid
// input with a readable message rather than silently falling back.
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
    // Validate the same effective 8-slot array the emitter renders and the
    // renderer reads (cycle-filled or truncated), not the raw authored list: a
    // one-color palette cycle-fills into 8 identical adjacent slots, and a
    // palette longer than 8 has slots past 8 that nothing ever renders.
    const light = effectivePalette(authored, CHART_PALETTE_SIZE)
    // A tenant's derived dark column is never guaranteed by derivation alone:
    // it holds each color's lightness and chroma in band, but not pair
    // separation. Check it too, so a custom palette does not report success
    // while shipping a failing dark column. This (and normalizeHex above, via
    // effectivePalette's cycled entries) is why the whole block runs inside
    // this try: a malformed hex must produce the readable message below, not
    // a raw stack trace.
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
  // validatePalette (via normalizeHex) throws a plain Error with an already
  // readable message on malformed input. The audience here is a tenant
  // pasting their own brand hex codes, not a developer, so print the message
  // alone and exit 1 rather than letting a raw stack trace with internal
  // file paths reach the terminal.
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}

if (failed) {
  console.log('One or more checks FAILED. A contrast WARN is not a failure, but it obligates visible labels or a table view.')
}
process.exit(failed ? 1 : 0)
