import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Markers of leftover Redash-era chrome. Editorial Light forbids all of them in
// restyled surfaces: hardcoded gray/semantic color classes across the
// bg/text/border/ring/fill/stroke/from/via/to utility prefixes (this also
// catches gradient hues and SVG fill/stroke hues; chrome color comes from
// design tokens, data color from src/lib/chart-colors), arbitrary hex colors,
// rgb()/hsl() color literals in arbitrary values, hand-rolled form controls
// that a primitive already covers, the hand-rolled underline tab strip, the
// hand-rolled primary button, and em/en dashes. Status tokens
// (bg-status-fresh, text-status-stale), token utilities (bg-muted,
// text-destructive, bg-primary/10, fill-favorite, text-favorite), and the
// base-ui primitives (<Select>, <Button>, <Input>) are all allowed and match
// none of these. Also carries the chart chrome retired in phase 2: a dashed
// CartesianGrid, a recharts Legend (self-closing or an open/close pair) that
// never passes our own content, and a raw numeric fontSize literal in any of
// the object-literal, JSX-expression, or JSX-string forms; a computed value
// like `fontSize={word.fontSize}` is deliberately left alone, since a
// computed size is exactly what a reader should write instead of a literal.
// Also carries the dual-axis rendering retired in phase 3: any `yAxisId`
// prop at all (every renderer in this tree has zero occurrences of it after
// the removal, so its mere presence means a second axis is coming back,
// whatever id string it uses), and an axis independently oriented to the
// right, which recharts only has a reason to do for a second axis.
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
  // Chart chrome retired in phase 2. A dashed grid reads as a projection or a
  // threshold; the pattern is anchored to CartesianGrid specifically because
  // annotation ReferenceLine and ReferenceArea marks use strokeDasharray
  // legitimately. Any self-closing <Legend> that never passes content is
  // recharts' own font and spacing, not ours, whatever other attributes it
  // carries. A numeric fontSize belongs in a named constant
  // (chart/axis-config.ts for recharts chrome, which this guard does not
  // cover since it is .ts and the walk takes .tsx only; a local named
  // constant elsewhere), not a bare literal spelled out at the call site, in
  // any of its object-literal, JSX-expression, or JSX-string forms, but not a
  // computed expression (`fontSize={x.y}`), which is the shape we want a
  // reader reaching for instead of a literal.
  { name: 'dashed grid', re: /<CartesianGrid[^>]*strokeDasharray/ },
  // Any <Legend ...> element, self-closing or an open/close pair, whose
  // attribute list never mentions content= (with or without whitespace
  // around the =), not just the exact empty-attribute <Legend />: recharts
  // renders its own default content for `<Legend verticalAlign="top" />` and
  // for a bare `<Legend></Legend>` just as much as for `<Legend />`. The
  // negative lookahead is scoped to the tag itself ([^>]* cannot cross the
  // closing >), so `<Legend content={<ChartLegend />} />` and the spaced
  // `<Legend content = {<ChartLegend />} />` both still pass: "content",
  // optional whitespace, then "=" appears before the first > (the one that
  // closes the nested <ChartLegend />), which trips the lookahead and
  // excludes them. Known gap: a spread like `<Legend {...legendProps} />` is
  // not covered, since the guard cannot see whether the spread object carries
  // a content key, so that spelling is flagged as bare even when it is not.
  { name: 'bare legend', re: /<Legend(?![^>]*\bcontent\s*=)[^>]*\/?>/ },
  // Any numeric literal fontSize, not just the object-literal form
  // (`fontSize: 12`) and the no-space JSX form (`fontSize={12}`): a quoted
  // JSX attribute (`fontSize="12"`), a spaced JSX expression
  // (`fontSize={ 12 }`), and either of the JSX forms with whitespace around
  // the = itself (`fontSize = "12"`, `fontSize = { 12 }`) are raw literals
  // just the same. A computed expression (`fontSize={word.fontSize}`) still
  // starts with a letter after the brace, not a digit or a quote, so it stays
  // legal. Known gap: the object-literal colon form is not whitespace-
  // tolerant on the colon side, so `fontSize : 12` (space before the colon)
  // still slips past, and a quoted string in that same form
  // (`fontSize: '12'`) is not covered either.
  { name: 'raw font size', re: /fontSize:\s*\d|fontSize\s*=\s*\{\s*\d|fontSize\s*=\s*["']\d/ },
  // Dual-axis rendering, removed in phase 3. Two independent y-scales on one
  // plot invent a correlation that is not in the data; an indexed comparison
  // replaced it. Banning the whole shape rather than one spelling: a first
  // pass here only matched a literal yAxisId="right", which missed a
  // differently named id paired with orientation="right" (a real second
  // axis that evades an id-string check entirely) and missed the exact
  // ternary this codebase used to have
  // (`yAxisId={... ? 'right' : 'left'}`), since that never contains the
  // literal substring "right" immediately after yAxisId's own `=`. Every
  // renderer in this tree has zero occurrences of `yAxisId` after the
  // removal, so any occurrence at all, under any id, is the thing coming
  // back.
  { name: 'yAxisId prop', re: /\byAxisId\s*=/ },
  // A second, independent check: an axis oriented to the right. recharts'
  // `orientation` prop only has a reason to point an axis away from its
  // default side when another axis already claims that side, so this is a
  // second axis appearing even if it somehow arrived without a `yAxisId`.
  { name: 'right-oriented axis', re: /orientation\s*=\s*["'{]?\s*["']?right/ },
]

export function findRedashEraChrome(source: string): string[] {
  return REDASH_ERA_PATTERNS.filter((p) => p.re.test(source)).map((p) => p.name)
}

// Vitest runs with cwd at the veodyn-de package root, so src is reachable there.
export function readAppSource(relFromSrc: string): string {
  return readFileSync(join(process.cwd(), 'src', relFromSrc), 'utf8')
}
