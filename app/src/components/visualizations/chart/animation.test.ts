import { readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readAppSource } from '@/test/redash-era-chrome'
import { SERIES_ANIMATION } from './animation'

// Recharts' draw-in animation never finishes under React 19, so a series that
// forgets to opt out renders as an empty plot with axes and a legend. That
// failure is invisible to a render test in jsdom, which does no layout and so
// draws nothing either way. Scanning the source is what actually catches it.

/**
 * Every recharts element that draws data and can therefore animate in.
 *
 * The point of a closed list is that a file may only open the marks its own
 * entry declares, so adding a mark to an existing chart module fails here until
 * somebody decides whether it needs the opt-out. Without it this guard compared
 * two whole-file counts, and an undeclared `<Scatter>` added to the combo chart
 * left both counts untouched and stayed green.
 *
 * `\b` keeps a container out of its mark's name: `<Funnel\b` does not match
 * `<FunnelChart`, because `l` and `C` are both word characters.
 */
const ALL_MARKS = [
  'Area', 'Bar', 'Line', 'Pie', 'Scatter', 'Funnel',
  'Radar', 'RadialBar', 'Treemap', 'Sankey', 'SunburstChart',
]

/**
 * Every module that imports recharts, the marks it opens, and whether those
 * marks have anything to opt out of.
 *
 * `optOut: false` is a claim about recharts, not a waiver: it means the element
 * takes no animation prop at all in 3.8, checked against its type declarations,
 * and the file is then required to carry NO spread rather than merely allowed
 * to omit one.
 */
const CHART_MODULES: { file: string; marks: string[]; optOut: boolean }[] = [
  // Bar as well as Area and Line: this module is a ComposedChart, and a combo
  // chart draws the series Redash marked as bars with <Bar> alongside them.
  { file: 'components/visualizations/chart/line-area-chart.tsx', marks: ['Area', 'Bar', 'Line'], optOut: true },
  { file: 'components/visualizations/chart/bar-chart.tsx', marks: ['Bar'], optOut: true },
  { file: 'components/visualizations/chart/pie-chart.tsx', marks: ['Pie'], optOut: true },
  { file: 'components/visualizations/chart/scatter-chart.tsx', marks: ['Scatter'], optOut: true },
  // The KPI history line. It moved here from components/kpi/ when KPI_HISTORY
  // became a registered type: it draws on dashboards and public reports now,
  // which is exactly where a frozen draw-in animation is an empty widget
  // nobody can explain. `<LineChart` does not match `<Line\b`, so the one
  // element declared here is the series itself.
  { file: 'components/visualizations/kpi-history-chart.tsx', marks: ['Line'], optOut: true },
  // A funnel that forgets the opt-out is one of the few cases jsdom WOULD
  // catch, since Trapezoid returns null at the zero height of the first frame.
  // The scan is still the belt.
  { file: 'components/visualizations/funnel-renderer.tsx', marks: ['Funnel'], optOut: true },
  // Spread on the chart element rather than on a series. Sunburst draws plain
  // Sectors with no Animate wrapper today, so this one is defensive.
  { file: 'components/visualizations/sunburst-renderer.tsx', marks: ['SunburstChart'], optOut: true },
  // Sankey takes no animation prop at all in recharts 3.8, so there is nothing
  // to opt out of and a spread here would be cargo.
  { file: 'components/visualizations/sankey-renderer.tsx', marks: ['Sankey'], optOut: false },
  // Chrome, not marks: these import recharts for the Legend and Tooltip types
  // and open no mark of their own.
  { file: 'components/visualizations/chart/chart-legend.tsx', marks: [], optOut: false },
  { file: 'components/visualizations/chart/chart-tooltip.tsx', marks: [], optOut: false },
]

const VISUALIZATIONS_ROOT = join(process.cwd(), 'src/components/visualizations')

// readAppSource resolves against src/, and the walk below works in absolute
// paths, so this is the one place the two spellings meet. POSIX separators
// because that is how CHART_MODULES spells its entries.
function appPathOf(abs: string): string {
  return relative(join(process.cwd(), 'src'), abs).split(sep).join('/')
}

// Found rather than listed. The table above still has to say which marks each
// module may open, since only a person knows that, but which modules exist is a
// fact on disk, and a hand-kept copy of it is what somebody forgets when they
// add a renderer. sankey-renderer.tsx went unscanned for exactly that reason.
function rechartsModules(): string[] {
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(abs)
        continue
      }
      if (!entry.name.endsWith('.tsx') || entry.name.includes('.test.')) continue
      if (!/from '(recharts|recharts\/.+)'/.test(readAppSource(appPathOf(abs)))) continue
      found.push(appPathOf(abs))
    }
  }
  walk(VISUALIZATIONS_ROOT)
  return found.sort()
}

/**
 * Does each `<Name ...>` in this source spread SERIES_ANIMATION on ITSELF?
 *
 * Per element rather than per file. Counting spreads anywhere in the file let
 * the opt-out be parked on a neighbour: move it off `<Scatter>` and onto the
 * `<ZAxis>` beside it and the totals still matched while the series went blank.
 * Brace depth is tracked so a `>` inside an attribute expression (`(v) => v`)
 * is not mistaken for the end of the opening tag.
 */
function opensWith(source: string, name: string): boolean[] {
  const results: boolean[] = []
  const re = new RegExp(`<${name}\\b`, 'g')
  let match: RegExpExecArray | null
  while ((match = re.exec(source)) != null) {
    let i = match.index + match[0].length
    let depth = 0
    while (i < source.length) {
      const c = source[i]
      if (c === '{') depth += 1
      else if (c === '}') depth -= 1
      else if (c === '>' && depth === 0) break
      i += 1
    }
    results.push(/\{\.\.\.SERIES_ANIMATION\}/.test(source.slice(match.index, i)))
  }
  return results
}

function countOf(source: string, re: RegExp): number {
  return source.match(re)?.length ?? 0
}

describe('chart series opt out of the recharts draw-in animation', () => {
  it('disables animation rather than tuning its duration', () => {
    expect(SERIES_ANIMATION.isAnimationActive).toBe(false)
  })

  it('accounts for every module under visualizations that imports recharts', () => {
    expect(rechartsModules()).toEqual([...CHART_MODULES.map((m) => m.file)].sort())
  })

  it.each(CHART_MODULES)('$file opens only the marks it declares', ({ file, marks }) => {
    const source = readAppSource(file)
    const opened = ALL_MARKS.filter((mark) => opensWith(source, mark).length > 0)

    expect(opened.sort()).toEqual([...marks].sort())
  })

  it.each(CHART_MODULES)('$file spreads SERIES_ANIMATION on each mark itself', ({ file, marks, optOut }) => {
    const source = readAppSource(file)
    const elements = marks.flatMap((mark) => opensWith(source, mark).map((ok) => ({ mark, ok })))

    // A file that declares marks must actually open one, or every assertion
    // below passes over an empty list and guards nothing.
    if (marks.length > 0) expect(elements.length).toBeGreaterThan(0)

    for (const { mark, ok } of elements) {
      // The mark name is in the asserted value, not only in a message, so a
      // failure names which element lost its opt-out.
      expect(`<${mark}> opts out: ${ok}`).toBe(`<${mark}> opts out: ${optOut}`)
    }

    // Nothing else in the file may carry the spread. This is what stops it
    // being moved onto an axis or a container that never animated anyway.
    expect(countOf(source, /\{\.\.\.SERIES_ANIMATION\}/g)).toBe(optOut ? elements.length : 0)
  })
})
