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

// The hole in the middle. recharts defaults it to a flat 50px, so in a tile
// under 100px the hole is wider than the chart and every sector (outerRadius
// below innerRadius) is dropped. Zero has no such threshold.
const INNER_RADIUS = 0

// The gap between rings. Named rather than left to recharts' identical default
// because outerRadiusFilling below solves recharts' ring equation and depends
// on this term.
const RING_PADDING = 2

// recharts' default sector text (SunburstChart.js defaultTextProps) hardcodes
// black glyphs behind a white halo, unreadable over a dark card. Same halo, in
// the surface and foreground tokens.
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
 * by and the colour it is filled with. A type alias, not an interface, because
 * recharts' SunburstData declares a string index signature and only an alias
 * gets the implicit one that makes it assignable to that.
 */
type PaintedNode = {
  name: string
  value: number
  fill?: string
  children?: PaintedNode[]
}

/**
 * Roll values up and paint one branch. recharts sizes each arc from the node's
 * OWN value and never sums its children, while buildSunburstModel puts a value
 * only on the leaf ending a path, so each node gets its own value plus its
 * descendants'. The colour is the branch's: every descendant is filled with the
 * colour resolved for the top-level node it hangs off.
 */
function paint(node: SunburstNode, fill: string): PaintedNode {
  const children = node.children?.map((child) => paint(child, fill))
  const own = node.value ?? 0
  const value = children ? children.reduce((total, child) => total + child.value, 0) + own : own
  return { name: node.name, value, fill, children }
}

/**
 * How many rings this tree draws. Not its depth: recharts begins drawing at the
 * root's children, so the synthetic root is a node but never a ring.
 */
function ringsOf(node: PaintedNode): number {
  if (!node.children || node.children.length === 0) return 0
  return 1 + Math.max(...node.children.map(ringsOf))
}

/**
 * The outerRadius that lands the outermost ring on the edge of the box.
 * recharts spreads its rings over (outerRadius - innerRadius) divided by the
 * tree's depth, and that depth counts the synthetic root it never draws, so the
 * drawing stops one ring short: half the available radius for a single level,
 * two thirds for two. This solves the same equation for the full radius. The
 * radius passed in is the one recharts measured, so lengths track the widget.
 */
function outerRadiusFilling(radius: number, rings: number): number {
  if (rings < 1) return 0
  const thickness = (radius - INNER_RADIUS - (rings - 1) * RING_PADDING) / rings
  return INNER_RADIUS + (rings + 1) * thickness
}

/**
 * Report the box recharts measured for itself, rather than adding a second
 * ResizeObserver: the ring math above has to agree with the number recharts is
 * dividing up, not with an independent measurement that could differ by a
 * padding or a rounding. Rendered as a child of the chart because that is where
 * the chart's store is in scope; it draws nothing.
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
 * The hover panel, in the app's own tokens. The drawn sector labels are bare
 * numbers, so this is the only place a wedge says which node it is. Not
 * recharts' default tooltip: that one inlines an opaque white background as a
 * style attribute, which no stylesheet reaches and viz-chrome-tokens.test.ts
 * cannot see.
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
    // A tree summing to zero is degraded, not drawn: recharts scales the angles
    // against the root's total, so a zero domain paints every sector at the
    // same made-up angle.
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
    // The chart's percentage height needs a containing block whose height is
    // definite. role/aria-label sit here because recharts owns the svg and
    // passes it nothing but width and height.
    <div className="p-4" style={{ height: FILLABLE_PANEL_HEIGHT }} role="img" aria-label="Sunburst">
      <SunburstChart
        data={tree}
        // Both are needed to track the widget: percentages alone are measured
        // once, at mount, and `responsive` adds the ResizeObserver that re-reads
        // the box when the dashboard tile changes size.
        responsive
        width="100%"
        height="100%"
        innerRadius={INNER_RADIUS}
        outerRadius={outerRadius > 0 ? outerRadius : undefined}
        ringPadding={RING_PADDING}
        // Reached only by a node with no fill of its own, which paint() never
        // produces. Named so the fallback is not recharts' hardcoded near-black.
        fill="var(--muted)"
        stroke="var(--card)"
        textOptions={SECTOR_LABEL}
        // Sunburst draws plain Sectors with no Animate wrapper, so it has
        // nothing to opt out of today. Spread regardless: this is the prop whose
        // absence turns a recharts chart silently blank under React 19.
        {...SERIES_ANIMATION}
      >
        <ReportRadius onMeasure={setRadius} />
        <Tooltip content={<SunburstTooltip />} />
      </SunburstChart>
    </div>
  )
}
