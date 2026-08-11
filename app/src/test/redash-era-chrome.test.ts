import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findRedashEraChrome, readAppSource, REDASH_ERA_PATTERNS } from './redash-era-chrome'

describe('redash-era-chrome helper', () => {
  it('flags a known Redash-era class', () => {
    expect(findRedashEraChrome('<div className="bg-gray-200" />')).toContain('gray color class')
  })
  it('passes clean token markup', () => {
    expect(findRedashEraChrome('<div className="bg-muted text-status-fresh" />')).toEqual([])
  })
  it('exposes a non-empty pattern set', () => {
    expect(REDASH_ERA_PATTERNS.length).toBeGreaterThan(0)
  })
  it('flags a fill hue class', () => {
    expect(findRedashEraChrome('<circle className="fill-blue-500" />')).toContain('hardcoded semantic color class')
  })
  it('flags a stroke gray class', () => {
    expect(findRedashEraChrome('<path className="stroke-gray-300" />')).toContain('gray color class')
  })
  it('flags a gradient hue class', () => {
    expect(findRedashEraChrome('<div className="from-red-500 to-pink-500" />')).toContain('hardcoded semantic color class')
  })
  it('flags arbitrary hex outside background', () => {
    expect(findRedashEraChrome('<span className="text-[#abc123]" />')).toContain('arbitrary hex color')
  })
  it('does not flag the favorite or status tokens', () => {
    expect(findRedashEraChrome('<svg className="fill-favorite text-favorite" />')).toEqual([])
    expect(findRedashEraChrome('<div className="text-status-fresh after:bg-foreground" />')).toEqual([])
  })
  it('flags a dashed CartesianGrid', () => {
    expect(findRedashEraChrome('<CartesianGrid strokeDasharray="3 3" />')).toContain('dashed grid')
  })
  it('does not flag a dashed ReferenceLine', () => {
    expect(findRedashEraChrome('<ReferenceLine strokeDasharray="4 4" />')).toEqual([])
  })
  it('flags a bare recharts Legend', () => {
    expect(findRedashEraChrome('<Legend />')).toContain('bare legend')
  })
  it('flags a Legend that carries an attribute but no content prop', () => {
    // recharts still renders its own default content for this: the guard was
    // anchored to the exact empty-attribute shape and missed it.
    expect(findRedashEraChrome('<Legend verticalAlign="top" />')).toContain('bare legend')
  })
  it('does not flag a Legend with our own content', () => {
    expect(findRedashEraChrome('<Legend content={<ChartLegend />} />')).toEqual([])
  })
  it('does not flag a Legend with our own content across multiple lines', () => {
    expect(
      findRedashEraChrome('<Legend\n  verticalAlign="top"\n  content={<ChartLegend />}\n/>'),
    ).toEqual([])
  })
  it('flags a bare Legend open/close pair with no self-closing slash', () => {
    expect(findRedashEraChrome('<Legend></Legend>')).toContain('bare legend')
  })
  it('does not flag a Legend with content spaced around the equals', () => {
    expect(findRedashEraChrome('<Legend content = {<ChartLegend />} />')).toEqual([])
  })
  it('flags a raw numeric font size', () => {
    expect(findRedashEraChrome('tick={{ fontSize: 12 }}')).toContain('raw font size')
  })
  it('flags a quoted numeric font size', () => {
    expect(findRedashEraChrome('fontSize="12"')).toContain('raw font size')
  })
  it('flags a spaced numeric font size in a JSX attribute', () => {
    expect(findRedashEraChrome('fontSize={ 12 }')).toContain('raw font size')
  })
  it('flags a quoted numeric font size spaced around the equals', () => {
    expect(findRedashEraChrome('fontSize = "12"')).toContain('raw font size')
  })
  it('does not flag a named font size constant', () => {
    expect(findRedashEraChrome('tick={AXIS_TICK}')).toEqual([])
  })
  it('does not flag a computed font size', () => {
    expect(findRedashEraChrome('fontSize={word.fontSize}')).toEqual([])
  })
  it('flags a literal yAxisId="right"', () => {
    expect(findRedashEraChrome('<YAxis yAxisId="right" orientation="right" />')).toContain('yAxisId prop')
  })
  it('flags a differently named yAxisId paired with orientation="right", which an id-string check alone would miss', () => {
    expect(findRedashEraChrome('<YAxis yAxisId="secondary" orientation="right" />')).toContain('yAxisId prop')
    expect(findRedashEraChrome('<YAxis yAxisId="secondary" orientation="right" />')).toContain('right-oriented axis')
  })
  it('flags the exact left/right ternary this codebase used to have', () => {
    expect(
      findRedashEraChrome("yAxisId={config.seriesOptions[name]?.yAxis === 1 ? 'right' : 'left'}"),
    ).toContain('yAxisId prop')
  })
  it('flags any yAxisId at all, even one naming the single axis', () => {
    expect(findRedashEraChrome('<YAxis yAxisId="left" />')).toContain('yAxisId prop')
  })
  it('does not flag the single axis with no yAxisId', () => {
    expect(findRedashEraChrome('<YAxis {...AXIS_LINE} tick={AXIS_TICK} />')).toEqual([])
  })
  it('does not flag an unrelated orientation prop on a non-axis primitive', () => {
    expect(findRedashEraChrome('<Tabs orientation="horizontal" />')).toEqual([])
  })
})

const sharedFurniture = [
  'components/layout/page-header.tsx',
  'components/shared/items-table.tsx',
  'components/ui/skeleton-card.tsx',
  'components/shared/code-block.tsx',
  'components/shared/input-with-copy.tsx',
  'components/shared/toast-provider.tsx',
  'components/shared/edit-in-place.tsx',
  'components/shared/tags-control.tsx',
  'components/shared/time-ago.tsx',
  'components/shared/paginator.tsx',
  'components/shared/big-message.tsx',
  'components/shared/offline-banner.tsx',
]

// Every renderer and editor under visualizations, found rather than listed: a
// list is a thing somebody forgets to extend when they add a renderer. This
// walks .tsx only, which is also why chart/axis-config.ts (a .ts file) and its
// sanctioned fontSize: 12 never reach this guard: do not "fix" the walk to
// include .ts, that would break the one legitimate raw font size in the tree.
function vizSources(): string[] {
  const root = join(process.cwd(), 'src', 'components', 'visualizations')
  const found: string[] = []
  const walk = (dir: string, rel: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(join(dir, entry.name), relPath)
      else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) found.push(relPath)
    }
  }
  walk(root, '')
  return found.map((p) => `components/visualizations/${p}`)
}

// Drawings, not chrome. These are SVG miniatures on a fixed 48x32 viewBox, so
// a `fontSize={15}` in them is drawing geometry on the same coordinate grid as
// `x={24}` and `width={40}`, not a type size in CSS pixels that could sensibly
// take a token: substituting the 12 of AXIS_TICK would resize the drawing and
// mean nothing. Colour is `currentColor` throughout, so they theme correctly by
// inheritance. Kept as an explicit list, not a path pattern, so adding one is a
// deliberate act.
const DECORATIVE = ['components/visualizations/viz-thumbnails.tsx']

describe('shared furniture carries no Redash-era chrome', () => {
  const guarded = [...sharedFurniture, ...vizSources().filter((rel) => !DECORATIVE.includes(rel))]

  it.each(guarded)('%s uses only Editorial Light tokens', (rel) => {
    expect(findRedashEraChrome(readAppSource(rel))).toEqual([])
  })

  it('finds every visualization source', () => {
    expect(vizSources().length).toBeGreaterThan(25)
  })
})
