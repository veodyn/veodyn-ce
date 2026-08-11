// The one rule two status bands have to satisfy before anything can be judged
// against them.
//
// It lived in components/kpi/kpi-form-model.ts, which is where its first caller
// is, until the EE-3 Task 6e target audit found its second: the KPI_HISTORY
// visualization's `validate`, which reports the same contradiction for a widget
// whose target and thresholds were configured in the visualization editor
// rather than on a KPI. That visualization is registered in CORE_VISUALIZATIONS
// and any query can use it, so the rule has to be reachable in a build with no
// KPI feature. Nothing in it is about a KPI: it takes a direction and two
// numbers.
import type { Direction } from '@/types/metric'

// The two bands have to be ordered the way the direction reads, otherwise
// statusForValue produces nonsense: with higher-is-better atRisk 70 and
// breached 90, a reading of 80 comes out breached. Returns null when the pair
// is well-ordered (or still incomplete, which the required-field checks own).
export function thresholdOrderError(
  direction: Direction,
  atRisk: number | null,
  breached: number | null
): string | null {
  if (atRisk === null || breached === null) return null
  if (direction === 'higher-is-better') {
    return atRisk > breached
      ? null
      : 'For higher is better, the at risk threshold must be above the breached threshold.'
  }
  return atRisk < breached
    ? null
    : 'For lower is better, the at risk threshold must be below the breached threshold.'
}
