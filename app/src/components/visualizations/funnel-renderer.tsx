'use client'

import { useMemo } from 'react'
import { Cell, Funnel, FunnelChart, LabelList, ResponsiveContainer, Text, Tooltip, Trapezoid } from 'recharts'
import type { FunnelTrapezoidItem, LabelProps, TooltipContentProps } from 'recharts'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import { resolveSeriesColor } from '@/lib/chart-colors'
import { CHART_INITIAL_DIMENSION, FILLABLE_PANEL_HEIGHT, STACK_SEGMENT_GAP } from '@/lib/chart-marks'
import { SERIES_ANIMATION } from './chart/animation'

/**
 * One funnel step, with both of its right-hand labels already written out.
 *
 * A LabelList only ever sees the one field its dataKey names, so a step's share
 * of the FIRST step has to be computed while the whole sorted list is still in
 * hand. Keeping the strings on the row is also what lets the tooltip and the
 * labels say the same thing without formatting the number twice.
 */
interface FunnelStep {
  label: string
  value: number
  valueLabel: string
  shareLabel: string
}

// The two label columns live in the plot margins, either side of the
// trapezoids. The numbers keep the w-24 the div stack reserved; the names get
// more than its w-28, because a step name is a phrase rather than a word and
// 112px truncated four of the five in the demo fixture. Measured at 1600px:
// the funnel still has ~340px of plot in a half-width dashboard tile.
const NAME_GUTTER = 150
const VALUE_GUTTER = 104
// Air between a column and the funnel itself.
const LABEL_GAP = 8
// A funnel has no axis, so chart/axis-config.ts is the wrong home for this:
// it is the label text size, named here rather than spelled out three times.
const LABEL_FONT_SIZE = 12
// Half a line of LABEL_FONT_SIZE text. The value and its share sit either side
// of the trapezoid's midline instead of printing over each other.
const HALF_LINE = 7
// The narrowest a step may be drawn, which is the `minWidth: '2px'` the div
// stack this replaced pinned every bar to.
const HAIRLINE_WIDTH = 2
// Enough for the top and bottom labels; they sit on trapezoid midlines, so they
// never reach the edge of the plot the way an axis tick would.
const CHART_MARGIN = { top: 8, right: VALUE_GUTTER, bottom: 8, left: NAME_GUTTER }

/**
 * One label, anchored to the plot box rather than to its own trapezoid.
 *
 * recharts' outside positions ('left', 'right') anchor to the sloping edge of
 * the trapezoid and clamp the text to the gap between that edge and the plot
 * box. For the widest step that gap is a few pixels wide, and recharts' Text
 * wraps rather than overflows, so a multi-word step name came out one word per
 * line. Anchoring to the plot box puts the two columns back where the div stack
 * had them, aligned down the page whatever shape the funnel takes.
 */
function columnLabel(
  { viewBox, parentViewBox, value }: LabelProps,
  align: 'start' | 'end',
  dy: number,
  ink: string,
  gutter: number,
) {
  // Both boxes are Cartesian on a funnel; the union recharts declares also
  // covers the polar shape, which carries neither height nor width.
  if (!viewBox || !('height' in viewBox)) return null
  if (!parentViewBox || !('width' in parentViewBox)) return null

  const y = viewBox.y + viewBox.height / 2 + dy
  const x = align === 'end' ? parentViewBox.x - LABEL_GAP : parentViewBox.x + parentViewBox.width + LABEL_GAP
  // ResponsiveContainer reports CHART_INITIAL_DIMENSION for one frame before
  // the mount effect measures the real box. Without this guard that frame emits
  // <text x="NaN">, the same trap SankeyNode is written by hand to avoid.
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  if (value == null || value === '') return null

  // recharts' Text rather than a bare <text>, for `maxLines`, which truncates
  // with an ellipsis instead of running off the edge. A plain <text> is not
  // clipped by the gutter, it is clipped by the SVG, so a step name wider than
  // NAME_GUTTER lost its first characters with nothing saying so: "Origin and
  // destination" drew as "gin and destination". Caught in the browser, since
  // jsdom does no text measurement and so never truncates. The div stack this
  // replaced used `truncate` for the same reason, so silent clipping was a
  // regression rather than a new limit. The full label is still on the tooltip.
  return (
    <Text
      x={x}
      y={y}
      dy="0.35em"
      textAnchor={align}
      fontSize={LABEL_FONT_SIZE}
      // The token as the `fill` prop, not as a fill-* utility class. Text
      // defaults `fill` to a hardcoded grey and writes it out as an attribute,
      // so a class alone left that literal in the DOM to win the moment the
      // stylesheet did not reach it. The renderer's own test caught it.
      fill={ink}
      width={gutter - LABEL_GAP}
      maxLines={1}
    >
      {value}
    </Text>
  )
}

// recharts renders a LabelList's `content` as a COMPONENT (createElement, not a
// plain call), so each column has to be a stable module-level function: an
// inline arrow would be a new component type every render and would remount
// every label with it.
function StepNameLabel(props: LabelProps) {
  return columnLabel(props, 'end', 0, 'var(--muted-foreground)', NAME_GUTTER)
}

function StepValueLabel(props: LabelProps) {
  return columnLabel(props, 'start', -HALF_LINE, 'var(--foreground)', VALUE_GUTTER)
}

function StepShareLabel(props: LabelProps) {
  return columnLabel(props, 'start', HALF_LINE, 'var(--muted-foreground)', VALUE_GUTTER)
}

/**
 * One step's trapezoid, floored at a hairline.
 *
 * recharts sizes each step against the largest value and then draws nothing at
 * all once both of a trapezoid's widths come out zero: Trapezoid returns null,
 * so a step worth 0 vanished from a funnel that still printed its name and its
 * 0 in the gutters beside the gap. The div stack this replaced pinned every bar
 * to minWidth: '2px', so an empty step always read as a step nothing reached.
 *
 * The floor is on the drawn WIDTH and never on the value: the gutter, the share
 * and the tooltip all still say 0, and 2px against a plot hundreds of pixels
 * wide cannot be read as a quantity. Substituting a value instead would make an
 * empty step look like a small one in every one of those places too.
 */
function StepTrapezoid(props: FunnelTrapezoidItem) {
  const upperWidth = Math.max(props.upperWidth, HAIRLINE_WIDTH)
  const lowerWidth = Math.max(props.lowerWidth, HAIRLINE_WIDTH)
  // recharts puts x at the funnel's midline minus half the upper width, so
  // widening the top without moving x would hang the hairline off to one side.
  return (
    <Trapezoid
      {...props}
      x={props.x - (upperWidth - props.upperWidth) / 2}
      upperWidth={upperWidth}
      lowerWidth={lowerWidth}
    />
  )
}

/**
 * The hover panel, in the app's own tokens.
 *
 * recharts' DEFAULT tooltip is not themed: it inlines an opaque white
 * background and a light grey border as style ATTRIBUTES, which no stylesheet
 * reaches and viz-chrome-tokens.test.ts cannot see, because the literals are in
 * recharts rather than here. Same reason SankeyTooltip exists; shaped for a
 * funnel rather than reused, since a step carries a share of the first step
 * that a flow diagram has no equivalent of.
 */
// Partial, for the reason ChartTooltip is: recharts clones this element and
// supplies the props itself, so the call site passes none.
export function FunnelTooltip({ active, payload }: Partial<TooltipContentProps<number, string>>) {
  // The row itself, not `name`/`value`: recharts hands the whole data object
  // back as `payload`, and the strings the labels draw are already on it.
  const step = payload?.[0]?.payload as FunnelStep | undefined
  if (!active || !step) return null

  return (
    <div className="rounded-md border bg-card px-3 py-2 text-sm shadow-md">
      <div className="mb-1 font-medium text-card-foreground">{step.label}</div>
      <div className="font-medium tabular-nums text-card-foreground">
        {step.valueLabel} <span className="text-muted-foreground">({step.shareLabel})</span>
      </div>
    </div>
  )
}

interface FunnelRendererProps {
  visualization: MockVisualization
  data: QueryResultData
}

export function FunnelRenderer({ visualization, data }: FunnelRendererProps) {
  const options = visualization.options as Record<string, unknown>
  const stepColumn = (options.stepColumn as string) || data.columns[0]?.name || ''
  const valueColumn = (options.valueColumn as string) || data.columns[1]?.name || ''
  const sortOrder = (options.sortOrder as string) || 'desc'

  const steps = useMemo<FunnelStep[]>(() => {
    if (!stepColumn || !valueColumn) return []
    const items = data.rows.map((row) => ({
      label: String(row[stepColumn] ?? ''),
      value: Number(row[valueColumn]) || 0,
    }))
    items.sort((a, b) => sortOrder === 'desc' ? b.value - a.value : a.value - b.value)
    // Share of the FIRST step, which is not always the largest: an ascending
    // sort puts the smallest first and every later step then reads over 100%.
    // That is what this renderer has always shown, and the funnel's own widths
    // are against the maximum either way, so the two do not have to agree.
    const first = items[0]?.value ?? 0
    return items.map((item) => ({
      ...item,
      valueLabel: item.value.toLocaleString(),
      shareLabel: `${first > 0 ? ((item.value / first) * 100).toFixed(1) : '0'}%`,
    }))
  }, [data.rows, stepColumn, valueColumn, sortOrder])

  if (steps.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Configure step and value columns to display funnel.
      </div>
    )
  }

  // Every trapezoid is scaled against the largest value, so a result with
  // nothing positive in it divides by zero, computes NaN geometry and paints an
  // empty panel that reads as a failed render rather than as a result. The
  // hairline above cannot cover this one: NaN is not a width to floor, and a
  // full column of hairlines would say the steps differ when they do not. Kept
  // apart from the message above because the cause is different: the columns
  // ARE configured and the query DID return rows.
  const largest = Math.max(...steps.map((step) => step.value))
  if (largest <= 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        No step has a value above zero, so there is no funnel to draw.
      </div>
    )
  }

  return (
    <div className="p-4" style={{ height: FILLABLE_PANEL_HEIGHT }}>
      <ResponsiveContainer initialDimension={CHART_INITIAL_DIMENSION}>
        <FunnelChart margin={CHART_MARGIN}>
          <Tooltip content={<FunnelTooltip />} />
          <Funnel
            data={steps}
            dataKey="value"
            nameKey="label"
            // Every trapezoid takes its colour from the Cell below. This is the
            // base recharts would otherwise fall back to, and its own default
            // is a hardcoded grey, so it is spelled out as the same palette
            // slot the first Cell resolves to rather than left to recharts.
            fill={resolveSeriesColor(steps[0].label, 0)}
            // recharts defaults this to 'triangle', which tapers the final step
            // to a point and so draws a stage the data does not have: everyone
            // dropping off after the last known step. A one-step funnel came out
            // a triangle where the div stack drew a full-width bar.
            lastShapeType="rectangle"
            shape={StepTrapezoid}
            // Funnel steps are touching stacked segments, and recharts' default
            // separator between them is a hardcoded white that stays white on a
            // dark card.
            {...STACK_SEGMENT_GAP}
            {...SERIES_ANIMATION}
          >
            {steps.map((step, i) => (
              <Cell key={i} fill={resolveSeriesColor(step.label, i)} />
            ))}
            <LabelList dataKey="label" content={StepNameLabel} />
            <LabelList dataKey="valueLabel" content={StepValueLabel} />
            <LabelList dataKey="shareLabel" content={StepShareLabel} />
          </Funnel>
        </FunnelChart>
      </ResponsiveContainer>
    </div>
  )
}
