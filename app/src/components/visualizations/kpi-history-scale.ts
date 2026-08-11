// The y axis arithmetic behind the KPI_HISTORY visualization.
//
// It lived in components/kpi until the EE-3 Task 6e target audit asked which
// side of the CE/EE line it falls on. Nothing in the KPI feature imports it:
// the KPI detail card draws through KpiHistoryChart like any other caller, and
// all three importers were already in this directory. What it computes is a
// domain and a set of bands from a list of numbers, a target and two
// thresholds, which is arithmetic a build with no KPI feature still needs,
// because KPI_HISTORY is a registered core visualization any query can use.
// Only the type names said otherwise, and those are MetricTarget,
// MetricThresholds and MetricStatus now.
import type { MetricStatus, MetricTarget, MetricThresholds } from '@/types/metric'

/**
 * What the history chart's y axis must span, and where the status bands sit on
 * it.
 *
 * Pulled out of the chart because the defect it fixes was arithmetic, not
 * drawing. The chart used recharts' `domain={['dataMin', 'dataMax']}`, which
 * scales to the series' own range, so EVERY series fills its box top to bottom
 * no matter where its target is. Average Rail Speed climbing 1.3 -> 1.58 against
 * a target of 25 drew the same rising-and-plateauing shape as a KPI climbing
 * 20 -> 25. The picture said "settled at target" for a reading at 6% of it.
 */

// A little air above and below, so the series and the reference lines are not
// drawn on the frame itself. Proportional to the span rather than a fixed
// number of units: a metric measured in percent and one measured in millions
// need the same visual margin, not the same numeric one.
const DOMAIN_PADDING = 0.08

export interface StatusBand {
  status: MetricStatus
  from: number
  to: number
}

/**
 * The y range, always including the target and both thresholds.
 *
 * That inclusion is the whole point: a breach is the DISTANCE between the
 * series and the target, and a domain that omits the target cannot show a
 * distance to it. Being off-scale is itself the most important thing the chart
 * has to say, so it is drawn rather than cropped away.
 */
// About this many gridlines. Not a guarantee: the step is snapped to a 1/2/5
// series, so the count lands near this rather than on it.
const TARGET_TICKS = 4

/** The 1, 2 or 5 times a power of ten nearest above `rough`. */
function niceStep(rough: number): number {
  if (!(rough > 0) || !Number.isFinite(rough)) return 1
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const normalized = rough / magnitude
  const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return multiplier * magnitude
}

export interface HistoryScale {
  domain: [number, number]
  /**
   * The gridlines, at exact multiples of the step.
   *
   * Handed to recharts rather than left to it. Given only a domain it splits
   * the range into `tickCount - 1` equal parts, so a domain of [75, 90] came
   * out as 75 / 78.75 / 82.5 / 86.25 / 90, which the formatter then rounded to
   * 75 / 79 / 83 / 87 / 90: round-looking numbers at uneven spacings, which is
   * worse than honest ugly ones because the axis reads as linear and is not.
   */
  ticks: number[]
}

export function historyScale(
  values: number[],
  target: MetricTarget,
  thresholds: MetricThresholds
): HistoryScale {
  const marks = [...values, target.value, thresholds.atRisk, thresholds.breached]
  const low = Math.min(...marks)
  const high = Math.max(...marks)
  // A flat series whose readings all equal the target: there is no span to take
  // a percentage of, so fall back to a unit of padding rather than returning a
  // zero-height domain recharts would render as a single line at the top.
  const span = high - low || Math.abs(high) || 1
  // Snapped outward to a round step rather than returned as the exact padded
  // bounds. recharts interpolates its ticks between whatever domain it is
  // given, so exact bounds produced an axis reading 3.552 / 5.552 / 7.552 /
  // 10.048 on a KPI measured in hours. The padding is applied first so the
  // snap cannot land a mark on the frame itself.
  const step = niceStep((span * (1 + 2 * DOMAIN_PADDING)) / TARGET_TICKS)
  const snapped = Math.floor((low - span * DOMAIN_PADDING) / step) * step
  // Snapping outward can cross zero: rail speeds of 1.3 to 1.6 against a target
  // of 25 snap to a step of 10 and a floor of -10, which spends a quarter of
  // the box on speeds that cannot happen and pushes the series back up into the
  // middle, undoing the fix. A series with no negative reading and no negative
  // rule gets a floor of zero.
  const min = low >= 0 ? Math.max(0, snapped) : snapped
  const max = Math.ceil((high + span * DOMAIN_PADDING) / step) * step

  const ticks: number[] = []
  // Stepped by index off `min` rather than accumulated, so a fractional step
  // (0.2 on a KPI measured in hours) cannot drift the last tick off `max` by
  // an epsilon and leave the top gridline a hair below the frame.
  for (let i = 0; min + i * step <= max + step / 2; i += 1) {
    ticks.push(Number((min + i * step).toPrecision(12)))
  }
  return { domain: [min, max], ticks }
}

/**
 * The bands to shade, in draw order, covering the whole domain.
 *
 * Derived from the thresholds rather than from the per-reading `status` each
 * KpiHistoryPoint carries. Both are available and they answer different
 * questions: a point's status says what it was WHEN IT WAS EVALUATED, against
 * whatever thresholds were configured then, and shading the plot from those
 * would draw a band that jumps whenever somebody edits the KPI. The bands are a
 * property of the scale, so they come from the scale's own numbers, and the
 * point statuses stay where they belong, on the readings themselves.
 *
 * `direction` flips which end is bad. higher-is-better breaches at the BOTTOM
 * of the axis; lower-is-better breaches at the top. Getting this backwards
 * would shade the healthy half red, which is worse than not shading at all.
 */
export function statusBands(
  [min, max]: [number, number],
  target: MetricTarget,
  thresholds: MetricThresholds
): StatusBand[] {
  const clamp = (value: number) => Math.min(Math.max(value, min), max)
  const breached = clamp(thresholds.breached)
  const atRisk = clamp(thresholds.atRisk)

  const bands: StatusBand[] =
    target.direction === 'higher-is-better'
      ? [
          { status: 'breached', from: min, to: breached },
          { status: 'at-risk', from: breached, to: atRisk },
          { status: 'on-track', from: atRisk, to: max },
        ]
      : [
          { status: 'on-track', from: min, to: atRisk },
          { status: 'at-risk', from: atRisk, to: breached },
          { status: 'breached', from: breached, to: max },
        ]

  // A band with no height is a band the reader cannot see, and recharts draws a
  // zero-height ReferenceArea as a hairline that reads as another threshold
  // rule. Thresholds that coincide, or sit outside the domain, produce these.
  return bands.filter((band) => band.to > band.from)
}

// Same mapping as KpiStatusBadge, which is the surface a reader compares this
// chart against. The tokens are CSS variables rather than hex, because recharts
// takes SVG presentation attributes and a literal colour here would be
// invisible to the theme and to the token guard.
export const STATUS_FILL: Record<MetricStatus, string> = {
  'on-track': 'var(--status-fresh)',
  'at-risk': 'var(--status-stale)',
  breached: 'var(--destructive)',
  // Never drawn: a history point always carries a measured value, so it always
  // lands in a real band. Present because the record is exhaustive over the
  // status union, which now includes the never-evaluated case.
  'no-data': 'var(--muted-foreground)',
}

// Faint enough that the series and the grid stay the foreground. The bands are
// context for the line, not content in their own right.
export const BAND_OPACITY = 0.07
