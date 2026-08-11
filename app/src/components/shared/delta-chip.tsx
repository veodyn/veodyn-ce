import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Direction } from '@/types/metric'

/**
 * A change against the previous evaluation, in the same unit as the value it
 * sits beside.
 *
 * Two things the arrow alone cannot say, so both are inputs:
 *
 * - **Zero is not an increase.** `delta >= 0` used to fold no-change in with a
 *   rise, so a KPI that had just been recomputed to the same number showed a
 *   green up arrow and "+0%".
 * - **Up is not always good.** Downtime hours rising is bad news. `direction`
 *   decides whether a rise is painted with the fresh or the stale token; the
 *   arrow keeps pointing the way the number actually moved.
 *
 * Both branches carry `data-testid="stat-delta"` so a test can ask whether a
 * delta is being reported at all, separately from what it says. Matching on
 * the label instead ("+0%") let an assertion that a chip was absent keep
 * passing after the label it named stopped existing.
 */
export const DELTA_CHIP_TESTID = 'stat-delta'

export function DeltaChip({
  delta,
  unit,
  direction = 'higher-is-better',
}: {
  delta: number
  unit?: string
  direction?: Direction
}) {
  // Matches StatNumber's suffix rule so the delta reads in the same unit as
  // the value directly above it: '%' hugs the number, anything else is spaced.
  const suffix = unit ? (unit === '%' ? '%' : ` ${unit}`) : ''

  if (delta === 0) {
    return (
      <span
        data-testid={DELTA_CHIP_TESTID}
        className="inline-flex items-center gap-0.5 font-mono text-xs tabular-nums text-muted-foreground"
      >
        <Minus className="size-3" />
        No change
      </span>
    )
  }

  const rose = delta > 0
  const isGood = direction === 'higher-is-better' ? rose : !rose

  // The magnitude is rounded; the value it sits beside is not. StatNumber shows
  // a settled value at full precision on purpose, because rounding the value of
  // record would misreport it. A delta is a change indicator rather than a value
  // of record, so the same rule turned a raw float loose in the chip: a KPI
  // recomputed by a hair rendered "-0.0035567007803818 mph" next to "1.582 mph".
  //
  // It cannot simply round to 2dp either. That prints "-0" for the case above,
  // which claims no change while the arrow beside it reports a fall, and the
  // delta === 0 branch already owns "No change". So 2dp is a floor, not a rule:
  // below it, switch to significant digits and let the smallest real movement
  // still read as movement.
  const magnitude = Math.abs(delta)
  const formattedMagnitude =
    magnitude >= 0.01
      ? magnitude.toLocaleString(undefined, { maximumFractionDigits: 2 })
      : magnitude.toLocaleString(undefined, { maximumSignificantDigits: 2 })

  return (
    <span
      data-testid={DELTA_CHIP_TESTID}
      className={cn(
        'inline-flex items-center gap-0.5 font-mono text-xs tabular-nums',
        isGood ? 'text-status-fresh' : 'text-status-stale'
      )}
    >
      {rose ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
      {rose ? '+' : '-'}
      {formattedMagnitude}
      {suffix}
    </span>
  )
}
