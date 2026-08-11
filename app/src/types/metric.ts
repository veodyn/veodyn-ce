// The vocabulary any number on a screen needs, independent of what produced it.
//
// This exists because two shared primitives, DeltaChip and StatNumber, imported
// exactly one thing from '@/types/kpi': the direction union, for one optional
// prop each. That single type import was enough to make two community
// components look like they belonged to the KPI feature, and moving them into
// the enterprise pack for it would have been the wrong trade. A hub counter and
// a dashboard stat have a direction too; only the union's old NAME said
// otherwise.
//
// Keep this domain-neutral. A type belongs here when a build with no KPI, report
// or alert feature still has something to say with it.

/**
 * Which way a metric is supposed to move.
 *
 * Consumed by anything that has to decide whether a rise is good news. The arrow
 * on a delta chip still points the way the number moved; this decides the colour
 * behind it, so a rise in downtime hours does not read as a win.
 */
export type Direction = 'higher-is-better' | 'lower-is-better'

/**
 * Where a number sits against the rule it is judged by.
 *
 * 'no-data' is display-only: a value always falls in some band, so nothing
 * derives this from a reading. It is what a metric that has not been evaluated
 * yet carries, so an unmeasured number stops presenting as a healthy one.
 */
export type MetricStatus = 'on-track' | 'at-risk' | 'breached' | 'no-data'

/** The number a metric is aimed at, and which way it is supposed to move. */
export interface MetricTarget {
  value: number
  direction: Direction
}

/**
 * The two bands that map a value to a MetricStatus, interpreted per direction.
 *
 * higher-is-better: on-track when value >= atRisk, at-risk when value is in
 * [breached, atRisk), breached when value < breached (so atRisk > breached).
 * lower-is-better is the mirror image (so breached > atRisk).
 */
export interface MetricThresholds {
  atRisk: number
  breached: number
}
