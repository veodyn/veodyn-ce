import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Markers of leftover Redash-era chrome, all forbidden in restyled surfaces:
// hardcoded gray and semantic color classes across the bg/text/border/ring/fill/
// stroke/from/via/to prefixes, arbitrary hex and rgb()/hsl() literals, hand-rolled
// form controls, tab strips and buttons a primitive already covers, and em/en
// dashes. Chrome color comes from design tokens, data color from
// src/lib/chart-colors; token utilities (bg-muted, text-destructive,
// fill-favorite) and the base-ui primitives match none of these.
//
// Also the chart chrome retired in phase 2 (a dashed CartesianGrid, a recharts
// Legend that never passes our own content, a raw numeric fontSize literal) and
// the dual-axis rendering retired in phase 3 (any yAxisId, any right-oriented
// axis).
export const REDASH_ERA_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'gray color class', re: /\b(?:bg|text|border|ring|fill|stroke|from|via|to)-(?:gray|slate|zinc|neutral|stone)-\d{2,3}\b/ },
  { name: 'hardcoded semantic color class', re: /\b(?:bg|text|border|ring|fill|stroke|from|via|to)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/ },
  { name: 'arbitrary hex color', re: /\b(?:bg|text|border|ring|fill|stroke|from|via|to)-\[#[0-9a-fA-F]{3,8}\]/ },
  { name: 'rgb/hsl color literal', re: /\b(?:bg|text|border|ring|fill|stroke)-\[(?:rgb|hsl)a?\(/ },
  { name: 'hand-rolled input ring', re: /focus:ring-[12] focus:ring-ring/ },
  { name: 'hand-rolled underline tab strip', re: /border-b-2 -mb-px/ },
  { name: 'hand-rolled primary button', re: /rounded-md bg-primary text-primary-foreground/ },
  { name: 'raw <select> element', re: /<select[\s>]/ },
  { name: 'em or en dash', re: new RegExp('[\\u2014\\u2013]') },
  // Anchored to CartesianGrid specifically: ReferenceLine and ReferenceArea marks
  // use strokeDasharray legitimately.
  { name: 'dashed grid', re: /<CartesianGrid[^>]*strokeDasharray/ },
  // Any <Legend ...>, self-closing or a pair, whose attribute list never mentions
  // content=. The negative lookahead is scoped to the tag ([^>]* cannot cross the
  // closing >), so `<Legend content={<ChartLegend />} />` passes. Known gap: a
  // spread like `<Legend {...legendProps} />` is flagged as bare even when it is
  // not, since the guard cannot see inside the spread object.
  { name: 'bare legend', re: /<Legend(?![^>]*\bcontent\s*=)[^>]*\/?>/ },
  // A numeric literal fontSize in the object-literal form and in either JSX form,
  // with or without whitespace around the =. A computed expression
  // (`fontSize={word.fontSize}`) starts with a letter, so it stays legal. Known
  // gaps: `fontSize : 12` (space before the colon) and `fontSize: '12'`. The
  // named constant for recharts chrome lives in chart/axis-config.ts, which this
  // guard does not scan (the walk takes .tsx only).
  { name: 'raw font size', re: /fontSize:\s*\d|fontSize\s*=\s*\{\s*\d|fontSize\s*=\s*["']\d/ },
  // Every renderer in this tree has zero occurrences of yAxisId after the phase 3
  // removal, so any occurrence at all, under any id, is a second axis coming back.
  // Matching the whole shape rather than a literal id catches the ternary form
  // (`yAxisId={... ? 'right' : 'left'}`) an id-string check missed.
  { name: 'yAxisId prop', re: /\byAxisId\s*=/ },
  // A second check: recharts' `orientation` only has a reason to point an axis
  // away from its default side when another axis already claims that side, so
  // this catches a second axis that arrived without a `yAxisId`.
  { name: 'right-oriented axis', re: /orientation\s*=\s*["'{]?\s*["']?right/ },
]

export function findRedashEraChrome(source: string): string[] {
  return REDASH_ERA_PATTERNS.filter((p) => p.re.test(source)).map((p) => p.name)
}

// Vitest runs with cwd at the veodyn-de package root, so src is reachable there.
export function readAppSource(relFromSrc: string): string {
  return readFileSync(join(process.cwd(), 'src', relFromSrc), 'utf8')
}
