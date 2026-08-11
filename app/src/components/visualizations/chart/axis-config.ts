import { getNiceTickValues } from 'recharts'
import type { NumberDomain } from 'recharts'
import type { RedashReferenceLine } from '@/services/redash/types'
import type { ResolvedChartConfig } from './resolve-config'

// recharts' function form of the `domain` prop: it is handed the plotted
// extremes and returns the domain to draw. The keyword form (['auto', 'auto'])
// cannot express the headroom below, because a per-bound function only ever
// sees its own bound and the headroom is a share of the span between the two.
export type YAxisDomain = (dataDomain: NumberDomain) => NumberDomain

export interface YAxisRenderProps {
  scale: 'linear' | 'log'
  domain: YAxisDomain
  // Travels with the domain rather than sitting in the chrome constants below,
  // because it is what makes the domain mean anything. Left on its default,
  // recharts re-rounds a numeric domain onto a tick grid of its own: a domain
  // with an 'auto' bound gets stretched out to the next tick beyond it (up to
  // twice the headroom asked for), and one without pins its outermost ticks to
  // the exact ends of the domain, which labels the top of the axis with
  // whatever the padding arithmetic produced ("25,860"). 'none' leaves the
  // domain as returned and has the scale pick round tick values inside it, so
  // the space above the highest one is the headroom we asked for.
  niceTicks: 'none'
}

// A chart whose topmost mark sits on the plot's ceiling reads as full: the
// series is pinned against the frame with nowhere left to go, and a peak drawn
// on the top gridline cannot be told apart from one the frame cut off. Every
// value axis therefore stretches this much further above its floor than the
// data needs, which leaves the highest mark at 1/1.2 of the plot's height
// whatever the numbers are.
export const Y_AXIS_HEADROOM = 0.2

// The value axis of a chart whose marks grow from a baseline (bar-chart's
// swapped layout, where that axis runs along the bottom). It keeps the 0 floor
// recharts gives such an axis by default, since a bar cut off at its own
// lowest value misstates every comparison the chart exists to make, and takes
// the headroom at the far end. A negative maximum reaches no further than the
// data, which recharts then extends back to it: bars pointing the other way
// get no headroom rather than a domain that hides them.
export const BASELINE_VALUE_DOMAIN: Readonly<[number, (dataMax: number) => number]> = [
  0,
  (dataMax) => dataMax * (1 + Y_AXIS_HEADROOM),
]

// recharts' own tick defaults (implicitYAxis.tickCount, allowDecimals),
// restated because the floor below comes out of recharts' tick algorithm and
// the two have to agree on the numbers: a floor picked against one tick count
// is not the floor the axis would otherwise have drawn.
const TICK_COUNT = 5
const ALLOW_DECIMALS = true

// The domain to draw for a value axis whose bounds were not pinned by hand:
// the plotted extremes plus headroom on top.
export function headroomDomain(dataDomain: NumberDomain, scale: 'linear' | 'log'): NumberDomain {
  const [dataMin, dataMax] = dataDomain
  // recharts hands back a non-finite pair when nothing numeric was plotted
  // ([Infinity, -Infinity] for an empty series). Returning it unchanged fails
  // recharts' own well-formed-domain check, which is how a domain function
  // says "I have nothing to add, use the one you computed from the data".
  if (!Number.isFinite(dataMin) || !Number.isFinite(dataMax)) return dataDomain
  if (scale === 'log') {
    // Headroom on a log axis is a share of the span in LOG space. An additive
    // pad that looks generous on a linear axis all but vanishes once the axis
    // spans decades: 1..1000 padded by a fifth of 999 reaches 1199, a
    // fifteenth of a decade. A domain touching or crossing zero has no log
    // span to take a share of (and no valid log coordinate either), so it is
    // left exactly as it came in.
    if (dataMin <= 0 || dataMax <= 0) return dataDomain
    return [dataMin, dataMax * (dataMax / dataMin) ** Y_AXIS_HEADROOM]
  }
  // The floor first, from recharts' own tick algorithm on the data as it came
  // in: that algorithm picks round tick values and stretches the domain out to
  // land on them, which is what puts the bottom of a 4.8K..22.3K chart on 4.5K
  // instead of on its own lowest point. Headroom is added on top only, so the
  // floor stays whatever it would have been before this function existed, and
  // a bar or an area still draws from the baseline it always did.
  const floor = niceFloorFor(dataDomain)
  // Measured from that floor rather than from the lowest value, because the
  // floor is what the reader actually sees at the bottom of the plot. A fifth
  // of 22.3K above a 0 baseline is real headroom, while a fifth of the 17.5K
  // between the two extremes gets swallowed by that same stretch down to 0 and
  // leaves the peak back up against the frame.
  const ceiling = floor + (dataMax - floor) * (1 + Y_AXIS_HEADROOM)
  // A single value the tick algorithm chose to sit exactly on the floor of its
  // own domain (0 is the one that does this) would otherwise scale nothing
  // against nothing. Left to recharts, which has a domain from the data.
  if (ceiling === floor) return dataDomain
  return [floor, ceiling]
}

// The bottom of the domain recharts itself would draw for this data: its tick
// values sit outside the data when that makes them rounder, and the outermost
// ones become the ends of the axis. Only the bottom is taken from it, since
// the top is where the headroom goes.
function niceFloorFor([dataMin, dataMax]: NumberDomain): number {
  const ticks = getNiceTickValues([dataMin, dataMax], TICK_COUNT, ALLOW_DECIMALS)
  return Math.min(dataMin, ticks[0] ?? dataMin)
}

// Module-level so the common case (neither bound pinned by hand) hands every
// render the same function. recharts compares the domain prop by identity and
// re-registers the axis when it changes, so a fresh closure per render would
// buy an extra pass over the data for nothing.
const LINEAR_HEADROOM_DOMAIN: YAxisDomain = (dataDomain) => headroomDomain(dataDomain, 'linear')
const LOG_HEADROOM_DOMAIN: YAxisDomain = (dataDomain) => headroomDomain(dataDomain, 'log')

// A hand-set rangeMin/rangeMax is what the reader asked the axis to show, so
// it is honoured exactly and gets no headroom. An unset bound falls through to
// the headroom domain, so pinning only the floor still leaves room above.
function yDomainFor(
  scale: 'linear' | 'log',
  rangeMin: number | undefined,
  rangeMax: number | undefined,
): YAxisDomain {
  if (rangeMin == null && rangeMax == null) {
    return scale === 'log' ? LOG_HEADROOM_DOMAIN : LINEAR_HEADROOM_DOMAIN
  }
  return (dataDomain) => {
    const [paddedMin, paddedMax] = headroomDomain(dataDomain, scale)
    return [rangeMin ?? paddedMin, rangeMax ?? paddedMax]
  }
}

// index 0 serves the one axis every renderer draws. Index 1 is kept only so
// this function still has a defined, tested default for a stored right-axis
// entry (config.yAxis[1]) that no renderer reads anymore since phase 3
// removed the second scale; nothing calls yAxisPropsFor(1, ...) outside its
// own test.
export function yAxisPropsFor(index: 0 | 1, config: ResolvedChartConfig): YAxisRenderProps {
  const axisOptions = config.yAxis[index]
  // Indexing preserves zero and can produce negative values (index-series.ts
  // divides by the base's magnitude but keeps the original sign), while a
  // log domain cannot cross zero: there is no valid coordinate for it. A
  // saved or editor-selected logarithmic scale forwarded unchanged into an
  // indexed chart makes every mark and tick vanish, so an indexed chart
  // always renders linear regardless of what was saved.
  const scale: YAxisRenderProps['scale'] = config.indexed
    ? 'linear'
    : axisOptions?.type === 'logarithmic' ? 'log' : 'linear'
  // A saved rangeMin/rangeMax was authored against raw magnitudes. Once a
  // chart indexes its series they live near 100 regardless of their original
  // scale, so honouring a stale bound (a chart formerly bounded to
  // 1,000,000..2,000,000, say) would put every mark outside its own domain
  // and render the plot blank. There is no correct conversion either, since
  // each series has its own base and the same raw bound would map to a
  // different indexed value per series. Auto-scaling is honest here; keeping
  // the stale bound is not.
  const domain = config.indexed
    ? yDomainFor(scale, undefined, undefined)
    : yDomainFor(scale, axisOptions?.rangeMin, axisOptions?.rangeMax)
  return { scale, domain, niceTicks: 'none' }
}

// A y reference line was authored against a raw magnitude (a 1,500,000
// threshold, say). Once a chart indexes, each series has its own base, so
// one raw threshold maps to a different indexed value per series: there is
// no single correct place left to draw it, so an indexed chart drops its y
// reference lines rather than drawing them in the wrong coordinate system.
// X reference lines mark a position along the x axis, which indexing never
// touches, so they keep working. Exported so every renderer that draws
// reference lines (line/area, bar, scatter) reads the same filtered list
// instead of each re-deriving "does this line survive indexing" on its own.
export function referenceLinesFor(config: ResolvedChartConfig): RedashReferenceLine[] {
  if (!config.indexed) return config.referenceLines
  return config.referenceLines.filter((line) => line.axis === 'x')
}

// Axis tick text. recharts' `tick` prop takes SVG presentation attributes
// rather than a className, and globals.css carries font families but no type
// scale, so the size lives here as one concrete value instead of being spelled
// out at each of the ten axes across the four renderers. Tick labels are
// numeric and stack vertically, so they take tabular figures and align.
export const AXIS_TICK = {
  fontSize: 12,
  fill: 'var(--muted-foreground)',
  fontVariantNumeric: 'tabular-nums',
} as const

// The axis line is the same recessive hairline as the grid rather than the
// heavier --muted-foreground it used to take: it is a reference edge, not
// content. The per-tick spur goes with it, since the label beneath already
// marks the position.
export const AXIS_LINE = {
  stroke: 'var(--border)',
  tickLine: false,
} as const

// Horizontal rules only, solid. A vertical grid on a categorical x axis is
// noise, and a dashed grid reads as "projection" or "threshold" when it is
// only a grid.
export const GRID = {
  stroke: 'var(--border)',
  vertical: false,
} as const

// Annotation and reference-line labels sit one size below the axis ticks, so
// they read as commentary layered on the chart rather than another axis. Named
// here rather than spelled out at each call site, same reasoning as AXIS_TICK.
export const ANNOTATION_LABEL_FONT_SIZE = 11

// The y-axis title, used when a chart is indexed and the numbers are
// percentages of each series' own first nonzero value rather than raw
// magnitudes. The reader cannot infer that from the ticks alone.
export const AXIS_LABEL = {
  fill: 'var(--muted-foreground)',
  fontSize: 12,
} as const

// The one true description of what an indexed chart's base actually is,
// shared by every surface that discloses it (this axis label, the table
// caption, the table's column headers, and the accessible summary in
// chart-summary.ts) so they cannot say different things about the same
// number again. Deliberately does not say "first value": the base
// (index-series.ts's firstFiniteNonZeroMagnitude) is the first finite,
// NON-ZERO value anywhere in the series, which for a series like [0, 4, 8] is
// its second point, not its first x value.
export const INDEXED_BASE_DESCRIPTION = 'own first nonzero value'

// Wording deliberately does not say "every series starts at 100": index-series.ts
// divides by the base's magnitude and keeps the original sign, so a series that
// starts negative is indexed to -100, not 100.
export const INDEXED_AXIS_LABEL_TEXT = `Indexed to 100 at its ${INDEXED_BASE_DESCRIPTION} (a series starting negative reads as -100)`

// The left <YAxis> label prop for an indexed chart, built once so the two
// renderers that draw a vertical value axis (line/area, and bar-chart's
// ordinary horizontal-bars layout) pass identical wording and styling
// instead of each spelling out the object at its own call site.
export function indexedYAxisLabel() {
  return {
    value: INDEXED_AXIS_LABEL_TEXT,
    angle: -90,
    position: 'insideLeft' as const,
    ...AXIS_LABEL,
  }
}

// The value <XAxis> label prop for an indexed chart in bar-chart's swapped
// (vertical bars) layout, where the value axis runs along the bottom
// instead of along the left: same wording and styling as
// indexedYAxisLabel, laid out horizontally (no rotation) instead of
// rotated -90deg for a vertical axis.
export function indexedXAxisLabel() {
  return {
    value: INDEXED_AXIS_LABEL_TEXT,
    position: 'insideBottom' as const,
    ...AXIS_LABEL,
  }
}
