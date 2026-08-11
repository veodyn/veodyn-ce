// Mark geometry and hover chrome, in one place for the same reason
// chart/axis-config.ts holds the axis tokens: recharts takes all of this as SVG
// presentation props rather than classNames, so a value spelled out at a call
// site is a value that drifts between the five things that draw a series (the
// four chart renderers plus the KPI sparkline).
//
// Every number here is a data-viz mark spec, and every one of them replaces a
// recharts default that is either the wrong weight or a hardcoded colour. The
// defaults cited below are from recharts 3.8.0 and were read out of the
// installed package, not remembered.

// The line itself. recharts' Line defaults to strokeWidth: 1
// (lib/cartesian/Line.js), which is a hairline: the same weight as the grid it
// is drawn over, so the data reads no louder than its own scaffolding. Round
// cap and join so a peak draws as a peak rather than a mitred spike.
export const LINE_MARK = {
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

// A wash, not a saturated block. At the previous 0.3 two stacked areas painted
// over each other and over the gridlines until neither the overlap nor the
// boundary read; the stroke on top is what carries the series' shape, and the
// fill only says which side of it belongs to the series.
export const AREA_FILL_OPACITY = 0.1

// The dot marking the reading under the pointer. recharts' own default is
// { r: 4, strokeWidth: 2, stroke: '#fff' } (lib/component/ActivePoints.js): the
// geometry is already the spec (an 8px marker carrying a 2px ring so it stays
// legible where it crosses its own line), but the ring is a hardcoded white
// that stays white on a dark card. Only the stroke changes here. The fill is
// left off deliberately so recharts keeps filling it with the series colour.
export const ACTIVE_DOT = {
  r: 4,
  strokeWidth: 2,
  stroke: 'var(--card)',
} as const

// The tooltip cursor. recharts hardcodes stroke: '#ccc' for every cursor shape
// (lib/component/Cursor.js), a cool grey that neither matches this palette's
// warm neutrals in light mode nor darkens in dark mode. A crosshair for the
// charts whose cursor renders as a line or a cross (line, area, scatter): the
// border token, same hairline as the grid, since a cursor is a reference edge
// and not content.
export const AXIS_CURSOR = { stroke: 'var(--border)' } as const

// Bar's cursor renders as a Rectangle spanning the hovered category, so it
// wants a filled band rather than a stroke: a stroked rect reads as a
// selection box around the bars instead of a highlight behind them.
export const BAND_CURSOR = { fill: 'var(--muted)', fillOpacity: 0.5 } as const

// Bars never fill their band; the leftover is air. Without a cap, recharts
// divides the whole category width between the series, so a three-category
// chart in a wide dashboard card paints three slabs a couple of hundred pixels
// across and stops reading as a measurement.
export const MAX_BAR_SIZE = 24

// The gap between adjacent bars inside one category. recharts defaults to 4;
// this is the same 2px of surface that separates the segments of a stack, so a
// grouped chart and a stacked one put the same amount of white between two
// touching marks.
export const BAR_GAP = 2

// Touching stacked segments are separated by surface colour, not by a border.
// An SVG stroke is centred on the edge it is drawn along, so a 2px stroke in
// the card colour puts 1px outside each of the two segments meeting at a
// boundary, and the gap between them is 2px. Apply only when the bars actually
// stack: on a grouped chart BAR_GAP already does the separating, and this would
// just shave a pixel off both sides of every bar.
export const STACK_SEGMENT_GAP = { stroke: 'var(--card)', strokeWidth: 2 } as const

const BAR_RADIUS = 4

interface BarRadiusInput {
  layout: 'horizontal' | 'vertical'
  // False for a segment with another one stacked on top of it: only the end of
  // the whole bar is rounded, every segment under it stays square.
  isDataEnd: boolean
  // recharts rounds the same corners whether a value is positive or negative,
  // so on a chart that crosses zero it would round the end sitting ON the
  // baseline and leave the end in the air square: the rounding would then read
  // as decoration rather than as "this is where the value stops". Square
  // everything instead, which is honest at every sign.
  hasNegative: boolean
}

// recharts' Rectangle radius order: [topLeft, topRight, bottomRight, bottomLeft].
// A horizontal layout draws columns growing up from the baseline, so the data
// end is the top; a vertical (swapped) layout draws bars growing right, so it
// is the right edge.
export function barRadius({
  layout,
  isDataEnd,
  hasNegative,
}: BarRadiusInput): number | [number, number, number, number] {
  if (!isDataEnd || hasNegative) return 0
  return layout === 'vertical'
    ? [0, BAR_RADIUS, BAR_RADIUS, 0]
    : [BAR_RADIUS, BAR_RADIUS, 0, 0]
}

// Whether any plotted value is below zero, which is what decides the rounding
// above. Takes the drawn rows and the series actually rendered, so a negative
// sitting in a column the chart does not draw cannot square its bars.
export function hasNegativeValue(rows: Record<string, unknown>[], seriesNames: string[]): boolean {
  return rows.some((row) => seriesNames.some((name) => Number(row[name]) < 0))
}

// recharts' ResponsiveContainer starts at `initialDimension` {width: -1,
// height: -1} and warns on its FIRST render, before the ResizeObserver has
// measured anything. That is one console line per chart per mount, in
// production as well as dev (`isDev` is hardcoded true in its LogUtils), so a
// four-widget dashboard logs four of them and a real warning gets buried.
//
// Height 1 and width still NEGATIVE, which is the whole trick and the reason
// this is a named constant with a paragraph attached rather than an inline
// literal. The warning fires unless one calculated dimension is positive, so a
// positive height silences it. Children still do not render, because
// ResponsiveContainer requires BOTH dimensions positive before it mounts them.
// Give width a positive value instead and the chart paints once at that made-up
// size and again at the real one, trading a log line for a visible flash of a
// wrong-sized chart. That is a worse deal than the warning.
export const CHART_INITIAL_DIMENSION = { width: -1, height: 1 } as const

// A page that wants its charts to fill the room it gave them sets this on any
// ancestor; custom properties inherit, so opting in is one declaration on a
// container and needs no prop threaded through the plugin renderer interface.
//
// Lives here rather than on ChartFrame because ChartFrame is not the only thing
// that honours it. Five renderers draw outside the Cartesian frame (choropleth,
// map, sankey, sunburst, word cloud) and each hardcoded its own 400px box, so
// the query page's fill reached four chart types out of nine: a sankey on a
// 1881px window drew in 400px with 1342px of blank page under it, measured.
export const CHART_FILL_VAR = '--chart-frame-fill'

// What a fillable panel puts in `height`. The 400px it hardcoded is kept as the
// fallback, so nothing changes anywhere that has not opted in.
//
// Only for a renderer whose CONTENT scales with the box, which is a real
// precondition and not a formality. Sunburst and word cloud were given this and
// reverted once, because both drew a fixed square SVG centred in a flex box: a
// taller box left the drawing the same size with ~570px of dead space above and
// below it. Measured in Chrome at a 1881px viewport: box 1625, svg still
// 480x480. Both now qualify, sunburst because it draws through recharts with
// `responsive`, and word cloud because its SVG sizes as a percentage against
// the viewBox its layout already used. Choropleth, sankey and funnel qualify
// for the same reason: their content is width and height 100%.
export const FILLABLE_PANEL_HEIGHT = `var(${CHART_FILL_VAR}, 400px)`
