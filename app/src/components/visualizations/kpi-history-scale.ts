// The y axis arithmetic behind the KPI_HISTORY visualization: a domain and a
// set of bands from a list of numbers, a target and two thresholds. Needed by
// any build, since KPI_HISTORY is a core visualization any query can use.
import type { MetricStatus, MetricTarget, MetricThresholds } from '@/types/metric'

/**
 * What the history chart's y axis must span, and where the status bands sit on
 * it. Not recharts' `domain={['dataMin', 'dataMax']}`, which scales to the
 * series' own range so every series fills its box top to bottom whatever its
 * target: 1.3 -> 1.58 against a target of 25 drew the same shape as 20 -> 25.
 */

// A little air above and below, so the series and the reference lines are not
// drawn on the frame itself. Proportional to the span, so a metric in percent
// and one in millions get the same visual margin, not the same numeric one.
const DOMAIN_PADDING = 0.08

export interface StatusBand {
  status: MetricStatus
  from: number
  to: number
}

/**
 * The y range always includes the target and both thresholds: a breach is the
 * distance between the series and the target, so a domain omitting the target
 * cannot show one.
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
   * The gridlines, at exact multiples of the step, handed to recharts rather
   * than left to it: given only a domain it splits the range into
   * `tickCount - 1` equal parts, so [75, 90] came out as 75 / 78.75 / 82.5 /
   * 86.25 / 90, which the formatter rounded to round-looking numbers at uneven
   * spacings.
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
  // A flat series whose readings all equal the target has no span to take a
  // percentage of, so fall back to a unit of padding rather than a zero-height
  // domain recharts renders as a single line at the top.
  const span = high - low || Math.abs(high) || 1
  // Snapped outward to a round step, not the exact padded bounds: recharts
  // interpolates its ticks across whatever domain it is given, so exact bounds
  // produced an axis of 3.552 / 5.552 / 7.552 / 10.048. Padding is applied
  // first so the snap cannot land a mark on the frame.
  const step = niceStep((span * (1 + 2 * DOMAIN_PADDING)) / TARGET_TICKS)
  const snapped = Math.floor((low - span * DOMAIN_PADDING) / step) * step
  // Snapping outward can cross zero: 1.3 to 1.6 against a target of 25 snaps to
  // a step of 10 and a floor of -10, spending a quarter of the box on values
  // that cannot happen. A series with no negative reading gets a floor of zero.
  const min = low >= 0 ? Math.max(0, snapped) : snapped
  const max = Math.ceil((high + span * DOMAIN_PADDING) / step) * step

  const ticks: number[] = []
  // Stepped by index off `min`, not accumulated: a fractional step (0.2) would
  // otherwise drift the last tick off `max` by an epsilon.
  for (let i = 0; min + i * step <= max + step / 2; i += 1) {
    ticks.push(Number((min + i * step).toPrecision(12)))
  }
  return { domain: [min, max], ticks }
}

/**
 * The bands to shade, in draw order, covering the whole domain. Derived from
 * the thresholds, not from each KpiHistoryPoint's own `status`, which records
 * what it was when it was evaluated against whatever thresholds were
 * configured then.
 *
 * `direction` flips which end is bad: higher-is-better breaches at the BOTTOM
 * of the axis, lower-is-better at the top.
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

  // recharts draws a zero-height ReferenceArea as a hairline that reads as
  // another threshold rule. Coinciding or out-of-domain thresholds produce these.
  return bands.filter((band) => band.to > band.from)
}

// Same mapping as KpiStatusBadge, which readers compare this chart against.
// CSS variables rather than hex: recharts takes these as SVG presentation
// attributes, and a literal colour is invisible to the theme and the token guard.
export const STATUS_FILL: Record<MetricStatus, string> = {
  'on-track': 'var(--status-fresh)',
  'at-risk': 'var(--status-stale)',
  breached: 'var(--destructive)',
  // Never drawn: a history point always carries a measured value. Present
  // because the record is exhaustive over the status union.
  'no-data': 'var(--muted-foreground)',
}

// Faint enough that the series and the grid stay the foreground.
export const BAND_OPACITY = 0.07
