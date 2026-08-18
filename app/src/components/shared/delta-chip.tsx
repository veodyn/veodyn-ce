import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Direction } from '@/types/metric'

/**
 * A change against the previous evaluation, in the same unit as the value it
 * sits beside.
 *
 * - Zero is its own case, not an increase.
 * - Up is not always good (downtime hours rising is bad news). `direction`
 *   picks the fresh or stale token; the arrow follows the number.
 *
 * Both branches carry `data-testid="stat-delta"`, so a test can ask whether a
 * delta is reported at all separately from what it says.
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

  // The magnitude is rounded, unlike the StatNumber it sits beside, which shows
  // a value of record at full precision. 2dp is a floor rather than a rule:
  // rounding a tiny change to 2dp prints "-0", which claims no change while the
  // arrow beside it reports a fall, so below it switch to significant digits.
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
