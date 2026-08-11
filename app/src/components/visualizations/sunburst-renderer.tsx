'use client'

import { useEffect, useMemo, useState } from 'react'
import { SunburstChart, Tooltip, useChartHeight, useChartWidth } from 'recharts'
import type { TooltipContentProps } from 'recharts'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import type { RedashSunburstOptions } from '@/services/redash/types'
import { formatLabelValue } from '@/lib/chart-format'
import { resolveSeriesColor } from '@/lib/chart-colors'
import { FILLABLE_PANEL_HEIGHT } from '@/lib/chart-marks'
import { SERIES_ANIMATION } from './chart/animation'
import { buildSunburstModel, type SunburstNode } from './sunburst-model'

// The hole in the middle, and the one piece of recharts' ring geometry whose
// default is a flat pixel count rather than a share of the box: 50px. In a tile
// shorter than 100px that hole is wider than the chart, and a sector whose
// outerRadius falls below its innerRadius is dropped entirely, so the chart
// empties out as the tile shrinks. Zero has no such threshold.
const INNER_RADIUS = 0

// The gap between rings. Named here rather than left to recharts' identical
// default because outerRadiusFilling below solves recharts' own ring equation,
// and a term that equation depends on must not be free to drift out from under
// it.
const RING_PADDING = 2

// recharts labels every sector with its own value, and its default text options
// (SunburstChart.js defaultTextProps) are black glyphs behind a white halo, both
// hardcoded, so the labels stay black-on-white over a dark card. Same halo, in
// the surface and foreground tokens instead.
const SECTOR_LABEL = {
  fill: 'var(--foreground)',
  stroke: 'var(--card)',
  paintOrder: 'stroke fill',
  fontWeight: 'bold',
  fontSize: '.75rem',
  pointerEvents: 'none',
} as const

/**
 * A tree in the shape recharts draws: every node carries the total it is sized
 * by and the colour it is filled with.
 *
 * A type alias rather than an interface because recharts' SunburstData declares
 * a string index signature, and only an alias gets the implicit one that makes
 * it assignable to that.
 */
type PaintedNode = {
  name: string
  value: number
  fill?: string
  children?: PaintedNode[]
}

/**
 * Roll values up and paint one branch.
 *
 * recharts sizes each arc from the node's OWN value and never sums its
 * children, where the d3 layout this replaced ran hierarchy().sum() first.
 * buildSunburstModel puts a value only on the leaf that ends a path, so without
 * this every node above a leaf would size to nothing. Own value PLUS
 * descendants, which is what .sum() computed: a node that both ends one path
 * and continues another carries both.
 *
 * The colour is the branch's, not the node's: a descendant at any depth is
 * filled with the colour resolved for the top-level node it hangs off, so an
 * override targeting that top-level name reaches its whole branch.
 */
function paint(node: SunburstNode, fill: string): PaintedNode {
  const children = node.children?.map((child) => paint(child, fill))
  const own = node.value ?? 0
  const value = children ? children.reduce((total, child) => total + child.value, 0) + own : own
  return { name: node.name, value, fill, children }
}

/**
 * How many rings this tree draws.
 *
 * Not the same as its depth: the synthetic root is a node but never a ring,
 * because recharts begins drawing at the root's children.
 */
function ringsOf(node: PaintedNode): number {
  if (!node.children || node.children.length === 0) return 0
  return 1 + Math.max(...node.children.map(ringsOf))
}

/**
 * The outerRadius that lands the outermost ring on the edge of the box.
 *
 * recharts spreads its rings over (outerRadius - innerRadius) divided by the
 * depth of the tree it was handed, and that depth counts the synthetic root it
 * never draws. The drawing therefore stops one ring short of the box it was
 * given: half the available radius for a single level, two thirds for two, a
 * quarter of the area thrown away in the worst case. Solving that same equation
 * for the outerRadius that puts the last ring on the edge hands the rings back
 * the share the undrawn root was holding.
 *
 * The radius passed in is the one recharts measured for itself, so every length
 * here still tracks the widget. This buys the full radius without pinning the
 * drawing to a fixed pixel size, which is the whole reason the chart is
 * `responsive` in the first place.
 */
function outerRadiusFilling(radius: number, rings: number): number {
  if (rings < 1) return 0
  const thickness = (radius - INNER_RADIUS - (rings - 1) * RING_PADDING) / rings
  return INNER_RADIUS + (rings + 1) * thickness
}

/**
 * Report the box recharts measured for itself.
 *
 * Deliberately not a second ResizeObserver of our own: `responsive` already put
 * one on the wrapper and published what it saw, and the ring math above has to
 * agree with the number recharts is dividing up, not with an independent
 * measurement that could differ by a padding or a rounding. Rendered as a child
 * of the chart because that is where the chart's store is in scope; it draws
 * nothing.
 */
function ReportRadius({ onMeasure }: { onMeasure: (radius: number) => void }) {
  const width = useChartWidth()
  const height = useChartHeight()
  const radius = Math.min(width ?? 0, height ?? 0) / 2

  useEffect(() => {
    onMeasure(radius)
  }, [onMeasure, radius])

  return null
}

/**
 * The hover panel, in the app's own tokens.
 *
 * Recharts owns the sector markup now, so the per-node `<title>` the hand-drawn
 * arcs carried is gone with them, and the drawn labels are bare numbers. This is
 * the only place a wedge says which node it is. Not recharts' default tooltip:
 * that one inlines an opaque white background as a style attribute, which no
 * stylesheet reaches and viz-chrome-tokens.test.ts cannot see.
 */
// Partial for the reason ChartTooltip is: recharts clones this element and
// supplies the props itself, so the call site passes none.
export function SunburstTooltip({ active, payload }: Partial<TooltipContentProps<number, string>>) {
  const entry = payload?.[0]
  if (!active || !entry) return null

  return (
    <div className="rounded-md border bg-card px-3 py-2 text-sm shadow-md">
      <div className="mb-1 font-medium text-card-foreground">{String(entry.name ?? '')}</div>
      <div className="font-medium tabular-nums text-card-foreground">{formatLabelValue(entry.value)}</div>
    </div>
  )
}

interface SunburstRendererProps {
  visualization: MockVisualization
  data: QueryResultData
}

export function SunburstRenderer({ visualization, data }: SunburstRendererProps) {
  const [radius, setRadius] = useState(0)

  const options = useMemo(
    () => (visualization.options ?? {}) as RedashSunburstOptions,
    [visualization.options]
  )

  const tree = useMemo(() => {
    const model = buildSunburstModel(options, data)
    const branches = model.children ?? []
    // Every top-level node is a slice, coloured by its own name and its position
    // among the top-level slices.
    const children = branches.map((branch, index) => paint(branch, resolveSeriesColor(branch.name, index)))
    const value = children.reduce((total, child) => total + child.value, 0)
    // A tree that sums to zero is degraded, not drawn: recharts scales the
    // angles against the root's total, and a zero domain sends every sector to
    // the same made-up angle, so a query returning all-zero rows would paint
    // equal wedges that mean nothing. The d3 layout gave each of them zero
    // width and this renderer dropped them, landing here too.
    if (children.length === 0 || value <= 0) return null
    return { name: model.name, value, children }
  }, [options, data])

  if (!tree) {
    return <div className="p-4 text-sm text-muted-foreground">No data to display.</div>
  }

  // Zero on the first render and on the server, where nothing has been measured
  // yet. recharts' own default stands in for that pass and is corrected once the
  // box is known.
  const outerRadius = outerRadiusFilling(radius, ringsOf(tree))

  return (
    // Height, not the 400px this box used to hardcode: the chart's percentage
    // height needs a containing block whose height is definite, and now that the
    // drawing scales with its box, a surface that opts into filling its space
    // (the fill custom property) grows the rings instead of leaving a 360px
    // circle marooned in the middle of a taller panel. role/aria-label sit here
    // because recharts owns the svg and passes it nothing but width and height.
    <div className="p-4" style={{ height: FILLABLE_PANEL_HEIGHT }} role="img" aria-label="Sunburst">
      <SunburstChart
        data={tree}
        // The pair that makes it track the widget: percentage sizes for the
        // box, and `responsive` for the ResizeObserver that re-reads that box
        // when the dashboard tile changes size. Percentages alone are measured
        // once, at mount.
        responsive
        width="100%"
        height="100%"
        innerRadius={INNER_RADIUS}
        outerRadius={outerRadius > 0 ? outerRadius : undefined}
        ringPadding={RING_PADDING}
        // Reached only by a node with no fill of its own, which paint() never
        // produces. Named anyway so the fallback is not the near-black recharts
        // hardcodes for it.
        fill="var(--muted)"
        stroke="var(--card)"
        textOptions={SECTOR_LABEL}
        // Sunburst draws plain Sectors with no Animate wrapper, so it has
        // nothing to opt out of today. Spread regardless: this is the one prop
        // whose absence turns a recharts chart silently blank under React 19,
        // and a version that starts animating these arcs should not be able to
        // do it here first.
        {...SERIES_ANIMATION}
      >
        <ReportRadius onMeasure={setRadius} />
        <Tooltip content={<SunburstTooltip />} />
      </SunburstChart>
    </div>
  )
}
