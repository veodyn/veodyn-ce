import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))

// A `#` immediately preceded by `&` is an HTML entity (chart-editor.tsx's
// close icon is &#10005;, whose decimal digits 1/0/0/0/5 all fall inside
// [0-9a-fA-F] and would otherwise read as a hex literal), not a colour, so it
// is excluded here rather than by skipping the whole file or subtree it lives
// in.
const HEX_LITERAL = /(?<!&)#[0-9a-fA-F]{3,8}\b/

// Every renderer AND editor under visualizations, found rather than listed: a
// list is a thing somebody forgets to extend when they add one. Paths are
// relative to this file's own directory (src/components/visualizations/),
// since readFileSync below resolves against `here`, not against src/.
function renderersOf(): string[] {
  const found: string[] = []
  const walk = (dir: string, rel: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), rel ? `${rel}/${entry.name}` : entry.name)
        continue
      }
      if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) {
        found.push(rel ? `${rel}/${entry.name}` : entry.name)
      }
    }
  }
  walk(here, '')
  return found
}

const renderers = renderersOf()

// chart-frame.tsx (plot sizing math), chart/index.tsx (a chart-type
// dispatcher), and these editors carry no chrome of their own: no className
// or style touches color at all, either because they hand every mark off to
// a child renderer or because they are plain forms with no data colour to
// show. The "references tokens" check below asserts a positive (this file
// DOES use the sanctioned color path), which doesn't hold for a file with no
// color path to begin with, so they are excluded from that one check only;
// the hex and rgb/hsl checks above still cover them, and both trivially pass.
const CHROMELESS = [
  'chart/chart-frame.tsx',
  'chart/index.tsx',
  'editors/box-plot-editor.tsx',
  'editors/details-editor.tsx',
  'editors/funnel-editor.tsx',
  'editors/heatmap-editor.tsx',
  'editors/pivot-editor.tsx',
  'editors/sankey-editor.tsx',
  'editors/table-editor.tsx',
  // heatmap-renderer.tsx hands its cell's mark off to this child component,
  // the mirror image of chart-frame.tsx handing off to ITS child renderer:
  // backgroundColor/color arrive as already-computed props (chart-colors ran
  // in the parent), so this file has no color path of its own to reference.
  'heatmap-cell.tsx',
  // Decorative miniatures of what each visualization type produces, drawn for
  // pickers. Everything in them is stroked and filled with `currentColor` at
  // varying opacity, so a thumbnail inherits its tile's text colour and needs
  // no second palette for dark mode. That is the right answer for this file,
  // and it is precisely why there is no var(--...) or chart-colors reference
  // for the positive check to find.
  'viz-thumbnails.tsx',
  // An adapter that reads the saved column list and hands off to
  // QueryResultTable, or, for a result that is a single numeric cell, to
  // SingleValue. Both children own all of the chrome, so it has no colour path
  // of its own to reference.
  'table-renderer.tsx',
]

// Chart and chrome colors must come from chart-colors.ts (palette / scales) or
// design-token CSS vars, never a color literal in the renderer itself. The only
// sanctioned hex fallbacks live in chart-colors.ts (DEFAULT_PALETTE and the
// readCssVarHex fallbacks), so a hex, rgb(), rgba(), hsl(), or hsla() literal
// here is a real regression. Choropleth's rgb() fills come from
// getSequentialScaleHex in chart-colors.ts, not a literal in the renderer.
describe('new viz renderers keep chrome on design tokens', () => {
  it.each(renderers)('%s has no hardcoded hex color literal', (file) => {
    const source = readFileSync(join(here, file), 'utf8')
    expect(source).not.toMatch(HEX_LITERAL)
  })

  it.each(renderers)('%s has no hardcoded rgb()/rgba()/hsl()/hsla() color literal', (file) => {
    const source = readFileSync(join(here, file), 'utf8')
    expect(source).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/)
  })

  // `text-status-*` counts for the same reason `-muted-foreground` does: it is
  // a Tailwind class over a design token (--status-fresh / --status-stale in
  // globals.css), not a colour the renderer chose for itself. counter-renderer
  // is the file that made the omission visible, once its layout moved to
  // single-value.tsx and the trend arrow was the only colour it still owned.
  it.each(renderers.filter((file) => !CHROMELESS.includes(file)))('%s references tokens or the chart-colors module', (file) => {
    const source = readFileSync(join(here, file), 'utf8')
    expect(
      source.includes('chart-colors') ||
        source.includes('var(--') ||
        source.includes('-muted-foreground') ||
        source.includes('text-status-')
    ).toBe(true)
  })

  it('finds every renderer', () => {
    expect(renderers.length).toBeGreaterThan(30)
  })
})

describe('the hex literal pattern', () => {
  it('does not flag an HTML entity like the close icon in chart-editor.tsx', () => {
    expect('&#10005;').not.toMatch(HEX_LITERAL)
  })

  it('still flags a real inline hex color', () => {
    expect("style={{ color: '#fff' }}").toMatch(HEX_LITERAL)
  })
})
