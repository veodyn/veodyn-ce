// Tick placement and label granularity for a time x-axis. Separate from
// chart-format's per-value formatting because both choices are properties of
// the axis' visible span rather than of any single cell: the same timestamp
// reads as "15:22:25" on a ten-minute chart and "07-2026" on a quarterly one.
//
// The label's FORM comes from Settings > Formats, through date-pattern.ts: this
// module decides which fields a tick shows, not how they are written. What it
// used to do instead was slice an ISO string, which is why an operator could set
// a date format and watch every axis in the product ignore it.
//
// Everything here works in UTC, matching parseDateValue's reading of naive
// backend timestamps as UTC. Formatting a tick in local time would slide the
// labels off the round boundaries the ticks were placed on.

import {
  formatUtcPattern,
  withoutDay,
  withoutSeconds,
  withoutYear,
  withSeconds,
  yearOnly,
  type DisplayPatterns,
} from './date-pattern'

export type TimeGranularity = 'second' | 'minute' | 'day' | 'month' | 'year'

// The coarser unit a tick label leaves ambiguous, rendered on a second line
// under the ticks where it changes.
export type TimeAxisContext = 'date' | 'year'

const SECOND = 1_000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// Every step at or below a day divides a day evenly, which is what lets
// msTicks below align them by rounding against the epoch.
const MS_STEPS = [
  SECOND, 5 * SECOND, 15 * SECOND, 30 * SECOND,
  MINUTE, 5 * MINUTE, 15 * MINUTE, 30 * MINUTE,
  HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR,
  DAY, 2 * DAY, 7 * DAY, 14 * DAY,
]

const MONTH_STEPS = [1, 3, 6, 12, 24, 60, 120, 240, 600]
const COARSEST_MONTH_STEP = 600
const AVG_MONTH = 30.44 * DAY

// A guard against a pathological domain (a stray 1970 or 9999 row) generating
// ticks until the tab dies. Well past what any axis can render legibly.
const MAX_TICKS = 500

/**
 * The label unit that matches a tick step: labels should carry the unit the
 * ticks actually step in, so a 6-hour step reads "06:00" rather than "07-22"
 * repeated four times.
 */
export function granularityForStep(stepMs: number): TimeGranularity {
  if (!Number.isFinite(stepMs) || stepMs < MINUTE) return 'second'
  if (stepMs < DAY) return 'minute'
  if (stepMs < 28 * DAY) return 'day'
  if (stepMs < 365 * DAY) return 'month'
  return 'year'
}

/**
 * Timestamps on round boundaries covering [min, max], roughly `target` of them.
 *
 * Recharts would otherwise place ticks by dividing the numeric domain into
 * equal parts, which lands them on arbitrary epoch offsets: readable spacing,
 * unreadable labels ("15:22:25", "15:47:38", ...).
 *
 * `minStep` is the data's own resolution. Ticks finer than the points they sit
 * under are noise at best and wrong at worst: three daily rows spanning two
 * days would otherwise take a 6-hour step and label every one of them "00:00".
 */
export function niceTimeTicks(min: number, max: number, target = 8, minStep = 0): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return []
  if (max <= min) return [min]

  const ideal = Math.max((max - min) / Math.max(target, 2), minStep)
  const step = MS_STEPS.find((candidate) => candidate >= ideal)
  return step == null ? monthTicks(min, max, ideal) : msTicks(min, max, step)
}

function msTicks(min: number, max: number, step: number): number[] {
  // Steps up to a day divide the day evenly, so rounding up against the epoch
  // puts them on round UTC boundaries. Multi-day steps march from the UTC
  // midnight at or before min instead, which stays midnight-aligned without
  // pretending a 2-day step has a natural origin.
  let tick = step <= DAY ? Math.ceil(min / step) * step : startOfUtcDay(min)
  while (tick < min) tick += step

  const ticks: number[] = []
  for (; tick <= max && ticks.length < MAX_TICKS; tick += step) ticks.push(tick)
  return ticks
}

function monthTicks(min: number, max: number, ideal: number): number[] {
  const months = MONTH_STEPS.find((candidate) => candidate * AVG_MONTH >= ideal) ?? COARSEST_MONTH_STEP
  const start = new Date(min)
  const year = start.getUTCFullYear()

  // Align to the calendar: a 3-month step should land on quarters and a
  // 10-year step on decades, not on whatever month the first row happens to
  // fall in.
  const anchor =
    months < 12
      ? { year, month: Math.ceil(start.getUTCMonth() / months) * months }
      : { year: Math.ceil(year / (months / 12)) * (months / 12), month: 0 }

  const ticks: number[] = []
  for (let i = 0; ticks.length < MAX_TICKS; i++) {
    const tick = Date.UTC(anchor.year, anchor.month + i * months, 1)
    if (tick > max) break
    if (tick >= min) ticks.push(tick)
  }
  return ticks
}

/**
 * The data's own resolution: the smallest gap between two distinct timestamps,
 * or 0 when there are fewer than two. Hourly rows return an hour, daily rows a
 * day, which is the floor a tick step should respect.
 */
export function smallestGap(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  let smallest = 0
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1]
    if (gap > 0 && (smallest === 0 || gap < smallest)) smallest = gap
  }
  return smallest
}

function startOfUtcDay(ts: number): number {
  const date = new Date(ts)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

/**
 * The pattern a tick label takes at this granularity: the operator's configured
 * date or time format, reshaped to the precision the axis is stepping in.
 *
 * The setting decides the form and the axis decides the precision, so a chart
 * stepping in days reads '07/25' for an operator on MM/DD/YY and '25/07' for one
 * on DD/MM/YYYY, and neither of them gets a year repeated under every tick when
 * the second line already states it.
 */
function tickPatternFor(granularity: TimeGranularity, patterns: DisplayPatterns): string {
  switch (granularity) {
    case 'second':
      return withSeconds(patterns.timeFormat)
    case 'minute':
      return withoutSeconds(patterns.timeFormat)
    case 'day':
      return withoutYear(patterns.dateFormat)
    case 'month':
      return withoutDay(patterns.dateFormat)
    case 'year':
      return yearOnly(patterns.dateFormat)
  }
}

/**
 * A tick label at the given granularity, in the configured format. Deliberately
 * terse: the coarser unit that disambiguates it is rendered on a second line by
 * the axis tick, and only where it changes.
 */
export function formatDateTick(
  ts: number,
  granularity: TimeGranularity,
  patterns: DisplayPatterns,
): string {
  return formatUtcPattern(ts, tickPatternFor(granularity, patterns))
}

/**
 * The coarser unit a tick label at this granularity leaves ambiguous, or null
 * when the label stands on its own. "15:22" needs to say which day it belongs
 * to; "2026-07" does not need anything.
 */
export function contextFor(granularity: TimeGranularity): TimeAxisContext | null {
  if (granularity === 'second' || granularity === 'minute') return 'date'
  if (granularity === 'day') return 'year'
  return null
}

function contextPatternFor(context: TimeAxisContext, patterns: DisplayPatterns): string {
  return context === 'date' ? patterns.dateFormat : yearOnly(patterns.dateFormat)
}

export function formatDateContext(
  ts: number,
  context: TimeAxisContext,
  patterns: DisplayPatterns,
): string {
  return formatUtcPattern(ts, contextPatternFor(context, patterns))
}

/**
 * True where the context unit changes, which is the only place its label is
 * worth repeating: UTC midnight under a time-of-day axis, January 1st under a
 * day axis.
 */
export function startsContextPeriod(ts: number, context: TimeAxisContext): boolean {
  if (!Number.isFinite(ts) || ts !== startOfUtcDay(ts)) return false
  if (context === 'date') return true
  const date = new Date(ts)
  return date.getUTCMonth() === 0 && date.getUTCDate() === 1
}
